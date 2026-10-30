import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Talk to the canvas: speech in (Chrome speech recognition), a reply from /api/chat, and speech out (Chrome TTS).
 * The reply is compact JSON lines on a grid: {"say": "..."} sentences, each followed by the drawing lines for it.
 * A sentence and its drawing play together; the next sentence waits until both are done.
 *
 * For speed, two requests go out at once: a tiny "opener" (one sentence and a title, back in ~3s) and the full
 * answer, which is still being generated while the opener is spoken. The answer comes in parts of a few
 * sentences; each next part is requested as soon as the previous one arrives.
 */

type Msg = { role: "user" | "assistant"; content: string };
type Seg = { say: string; cmds: any[]; filler?: boolean };
type Entry = { who: "you" | "ai" | "info"; text: string };

/** One reply: segments arrive while it plays. */
class Turn {
  segs: Seg[] = [];
  mayClear = false;
  done = false;
  aborted = false;
  ctl = new AbortController();
  private wake = () => {};
  /** Something arrived (or the turn ended): wake the player. */
  notify() { const w = this.wake; this.wake = () => {}; w(); }
  changed() { return new Promise<void>((r) => (this.wake = r)); }
}

/** A reply line as an object, or null (fences, stray brackets, broken JSON). Plain prose becomes a sentence. */
function parse(raw: string): Record<string, any> | null {
  const s = raw.trim();
  if (!s || s.startsWith("```")) return null;
  if (s.startsWith("{")) { try { const o = JSON.parse(s); return o && typeof o === "object" ? o : null; } catch { return null; } }
  return /[a-z]/i.test(s) ? { say: s } : null;
}

/** Whether two sentences say much the same thing (most of their words in common). */
function similar(a: string, b: string) {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const x = words(a), y = words(b);
  const common = [...x].filter((w) => y.has(w)).length;
  return common / Math.max(1, Math.min(x.size, y.size)) > 0.6;
}

/** The board's grid, in page units: column and row spacing, and the size of a box. */
export const GRID = { col: 380, row: 220, w: 200, h: 90 };

/** Board text is a few plain words: no HTML, markdown or code. */
const clean = (s: unknown, max = 60) => {
  const t = String(s ?? "").replace(/<[^>]*>/g, " ").replace(/[`*_#{}<>]/g, "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, t.lastIndexOf(" ", max) > 0 ? t.lastIndexOf(" ", max) : max); // whole words only
};
const COLORS = ["black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "light-red", "red", "white"];
const GEOS = ["rectangle", "ellipse", "diamond", "cloud", "hexagon", "oval", "trapezoid", "triangle", "star", "octagon", "pentagon", "rhombus"];
/** tldraw rejects (and crashes on) unknown colors and shapes, so map near misses and fall back to a default. */
const color = (c: unknown, fallback = "blue") => { const s = String(c ?? "").toLowerCase().replace("gray", "grey").replace("purple", "violet").replace(" ", "-"); return COLORS.includes(s) ? s : fallback; };
const geo = (g: unknown) => (GEOS.includes(String(g)) ? String(g) : "rectangle");
const cell = (at: unknown): [number, number] => (Array.isArray(at) ? [Number(at[0]) || 0, Number(at[1]) || 0] : [0, 0]);

/** Turn a compact drawing line into canvas commands. */
function toCmds(o: Record<string, any>): any[] {
  const { col, row, w, h } = GRID;
  if (o.title) return [{ op: "text", name: "title", x: 0, y: -150, text: clean(o.title), size: "l" }];
  if (o.box) {
    const [c, r] = cell(o.at);
    return [{ op: "geo", name: clean(o.box, 40), geo: geo(o.shape), x: c * col, y: r * row, w, h, text: clean(o.label, 40), color: color(o.color), fill: "semi", size: "s" }];
  }
  if (Array.isArray(o.arrow)) {
    const [from, to] = o.arrow.map((n: unknown) => clean(n, 40));
    return [{ op: "arrow", from, to, text: clean(o.label, 24), size: "s", ...(o.back ? { bend: -60, dash: "dashed" } : {}) }];
  }
  if (o.note) { const [c, r] = cell(o.at); return [{ op: "text", x: c * col, y: r * row + 25, text: clean(o.note), size: "s", color: "grey" }]; }
  if (o.group) {
    const [c0, r0] = cell(o.from), [c1, r1] = cell(o.to ?? o.from);
    return [{ op: "frame", name: clean(o.group, 40), x: c0 * col - 40, y: r0 * row - 50, w: (c1 - c0) * col + w + 80, h: (r1 - r0) * row + h + 100, label: clean(o.label, 30) }];
  }
  if (o.option) {
    const [c, r] = cell(o.at);
    const list = (x: unknown) => (Array.isArray(x) ? x.slice(0, 2).map((t) => clean(t, 32)).filter(Boolean) : []);
    return [{ op: "option", name: clean(o.option, 40), x: c * col, y: r * row, label: clean(o.label, 40), pros: list(o.pros), cons: list(o.cons), color: color(o.color) }];
  }
  if (o.pick) return [{ op: "pick", name: o.pick }];
  if (o.page) return [{ op: "page", name: clean(o.page, 30) }];
  if (o.highlight) return [{ op: "highlight", name: o.highlight }];
  if (o.focus) return [{ op: "focus", name: o.focus }];
  if (o.move) { const [c, r] = cell(o.at); return [{ op: "update", name: o.move, x: c * col, y: r * row }]; }
  if (o.remove) return [{ op: "remove", name: o.remove }];
  if (o.clear) return [{ op: "clear" }];
  return [];
}

// ---- speech out

const voiceWanted = new URLSearchParams(location.search).get("voice") ?? "Google US English";
const pickVoice = () => {
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => v.name.includes(voiceWanted)) ?? vs.find((v) => v.lang === "en-US" && v.localService) ?? null;
};
let utterance: SpeechSynthesisUtterance | null = null; // keep a reference: Chrome drops events of collected utterances

function speak(text: string, onStart: () => void): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = pickVoice();
    u.rate = 1.05;
    const fallback = setTimeout(resolve, 3000 + text.length * 120); // in case Chrome never reports the end
    u.onstart = onStart;
    u.onend = u.onerror = () => { clearTimeout(fallback); resolve(); };
    utterance = u;
    speechSynthesis.speak(u);
  });
}

/** The board is the person's: the AI may only wipe it when they ask for a fresh start. */
const asksToClear = (text: string) => /\b(clear|wipe|erase|start over|from scratch|fresh|new (board|diagram|drawing|topic)|something (else|different))\b/i.test(text);

/** Said when the first part of an answer is slow to arrive. */
const FILLERS = ["Hmm, let me sketch it.", "Okay, let me draw this out.", "Let me show you.", "Right, let me sketch that."];
let fillerIndex = 0;
/** The longest reply we'll keep asking for, in parts. */
const MAX_PARTS = 6;

/** Play a reply as it streams in: speak each sentence while running its drawing commands in order. */
async function play(turn: Turn, run: (c: any) => Promise<void>, onSpeak: (text: string) => void) {
  for (let si = 0; !turn.aborted; si++) {
    while (!turn.segs[si] && !turn.done && !turn.aborted) await turn.changed();
    const seg = turn.segs[si];
    if (!seg || turn.aborted) return;
    const speech = seg.say ? speak(seg.say, () => onSpeak(seg.say)) : Promise.resolve();
    for (let i = 0; ; ) {
      if (turn.aborted) return;
      if (i < seg.cmds.length) { await run(seg.cmds[i++]).catch((e) => console.error("command failed", e)); continue; }
      if (turn.segs[si + 1] || turn.done) break;
      await turn.changed();
    }
    await speech;
  }
}

// ---- the panel

export function Talk({ run, describe }: { run: (c: any) => Promise<void>; describe: () => string }) {
  const [entries, setEntries] = useState<Entry[]>([{ who: "info", text: "Click the mic (or type) and ask me to explain something." }]);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [handsFree, setHandsFree] = useState(true);
  const [timing, setTiming] = useState("");
  const [typed, setTyped] = useState("");
  const history = useRef<Msg[]>([]);
  const turn = useRef<Turn | null>(null);
  const rec = useRef<any>(null);
  const handsFreeRef = useRef(handsFree);
  handsFreeRef.current = handsFree;
  const log = useRef<HTMLDivElement>(null);

  const add = (e: Entry) => setEntries((es) => [...es, e]);
  /** Append spoken text to the reply in progress. */
  const addSaid = (text: string) => setEntries((es) => {
    const last = es[es.length - 1];
    return last?.who === "ai" ? [...es.slice(0, -1), { who: "ai", text: `${last.text} ${text}` }] : [...es, { who: "ai", text }];
  });
  useEffect(() => { log.current?.scrollTo(0, log.current.scrollHeight); }, [entries, interim]);
  useEffect(() => { speechSynthesis.getVoices(); }, []); // starts Chrome loading its voice list
  // Replaying a saved conversation with recorded voices (demo videos): the recorder drives the panel and the drawing.
  useEffect(() => {
    (window as any).talkDemo = {
      listening: (on: boolean) => setListening(on),
      interim: (text: string) => setInterim(text),
      heard: (text: string) => { setInterim(""); setListening(false); add({ who: "you", text }); setTiming(""); },
      said: (text: string) => addSaid(text),
      timing: (text: string) => setTiming(text),
      handsFree: (on: boolean) => setHandsFree(on),
      run,
    };
  });

  /** Stop talking and drawing right now (the person is speaking). */
  function interrupt() {
    const t = turn.current;
    if (!t || t.aborted) return;
    t.aborted = true;
    t.ctl.abort();
    t.notify();
    speechSynthesis.cancel();
  }

  async function ask(text: string, heardAt = performance.now()) {
    interrupt();
    const t = new Turn();
    t.mayClear = asksToClear(text);
    turn.current = t;
    add({ who: "you", text });
    const secs = (x: number) => `${((x - heardAt) / 1000).toFixed(1)}s`;
    let firstWord = 0, firstAnswer = 0;
    const showTiming = () => setTiming([firstWord && `speaking ${secs(firstWord)}`, firstAnswer && `answer ${secs(firstAnswer)}`].filter(Boolean).join(" · "));
    setTiming("");
    const player = play(t, run, (said) => {
      addSaid(said);
      if (!firstWord) { firstWord = performance.now(); showTiming(); }
    });
    // Fill the silence if nothing has arrived yet (a chatty reply usually comes back in about a second).
    const filler = setTimeout(() => {
      if (t.segs.length || t.aborted) return;
      t.segs.push({ say: FILLERS[fillerIndex++ % FILLERS.length], cmds: [], filler: true });
      t.notify();
    }, 1800);

    const question: Msg[] = [...history.current, { role: "user", content: text }];
    // The opener plays first; the answer's lines wait for it (but not for more than a few seconds).
    let openGate!: () => void, gateOpen = false;
    const gate = new Promise<void>((r) => (openGate = () => { gateOpen = true; r(); }));
    const gateTimer = setTimeout(openGate, 6000);
    const opener = fetchPart(t, question, { mode: "opener" }, undefined, () => gateOpen, true)
      .catch(() => ({ raw: "", more: false }))
      .finally(() => { clearTimeout(gateTimer); openGate(); });

    const msgs = [...question];
    const parts: string[] = [];
    try {
      for (let n = 0; n < MAX_PARTS && !t.aborted; n++) {
        const { raw, more } = await fetchPart(t, msgs, n === 0 ? { afterOpener: true } : {}, gate);
        if (!firstAnswer) { firstAnswer = performance.now(); showTiming(); }
        parts.push(raw);
        if (!more) break;
        msgs.push({ role: "assistant", content: `${raw}\n{"more":true}` }, { role: "user", content: "(continue)" });
      }
    } catch (e: any) {
      if (!t.aborted) add({ who: "info", text: e.message });
    }
    clearTimeout(filler);
    t.done = true;
    t.notify();
    // History keeps the question and the whole answer (opener included) as one message.
    const said = [(await opener).raw, ...parts].join("\n").trim();
    history.current.push({ role: "user", content: text }, { role: "assistant", content: said + (t.aborted ? "\n(interrupted)" : "") || "(no reply)" });
    await player;
    // Every finished exchange is kept on window.talkLog, so a real conversation can be saved and replayed (demos).
    if (!t.aborted) ((window as any).talkLog ??= []).push({ question: text, segs: t.segs.filter((x) => !x.filler) });
    if (!t.aborted && turn.current === t && handsFreeRef.current) listen();
  }

  /**
   * One request: its lines are queued for playing as they arrive (after `gate`, if given; dropped once `late()`).
   * Returns the lines it kept and whether more parts follow.
   */
  async function fetchPart(t: Turn, messages: Msg[], extra: object, gate?: Promise<void>, late?: () => boolean, opener = false): Promise<{ raw: string; more: boolean }> {
    const res = await fetch("/api/chat", {
      method: "POST", signal: t.ctl.signal, headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, canvas: describe(), ...extra }),
    });
    if (!res.ok) throw new Error(await res.text());
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "", raw = "", more = false, open = !gate, said = 0;
    const held: string[] = [];
    const take = (l: string) => {
      const x = parse(l);
      if (!x || late?.()) return;
      // The opener is one sentence; it sometimes runs on into a whole answer (or draws), which is the main request's job.
      if (opener && !(typeof x.say === "string" && said++ === 0)) return;
      if (x.more === true) { more = true; return; }
      raw += l.trim() + "\n";
      // The answer sometimes opens by repeating the opener: keep its drawing, not the repeat.
      const prev = t.segs[t.segs.length - 1];
      if (typeof x.say === "string" && prev && !prev.filler && similar(prev.say, x.say)) { t.notify(); return; }
      if (typeof x.say === "string") t.segs.push({ say: x.say, cmds: [] });
      else {
        const cmds = typeof x.op === "string"
          ? [{ ...x, ...(x.text ? { text: clean(x.text) } : {}), ...(x.label ? { label: clean(x.label) } : {}), ...(x.color ? { color: color(x.color) } : {}), ...(x.geo ? { geo: geo(x.geo) } : {}) }]
          : toCmds(x);
        if (!t.mayClear) cmds.splice(0, cmds.length, ...cmds.filter((c) => c.op !== "clear"));
        if (cmds.length) (t.segs[t.segs.length - 1] ?? (t.segs[0] = { say: "", cmds: [] })).cmds.push(...cmds);
      }
      t.notify();
    };
    const line = (l: string) => (open ? take(l) : held.push(l));
    gate?.then(() => { open = true; held.splice(0).forEach(take); });
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let n;
      while ((n = buf.indexOf("\n")) >= 0) { line(buf.slice(0, n)); buf = buf.slice(n + 1); }
    }
    if (buf.trim()) line(buf);
    if (gate) { await gate; held.splice(0).forEach(take); }
    return { raw: raw.trim(), more };
  }

  function listen() {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return add({ who: "info", text: "Speech recognition isn't available in this browser. Type instead." });
    interrupt();
    rec.current?.abort();
    const r = new SR();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    let heardAt: number | undefined, sent = false;
    r.onspeechend = () => (heardAt = performance.now());
    r.onresult = (e: any) => {
      let fin = "", mid = "";
      for (const res of e.results) res.isFinal ? (fin += res[0].transcript) : (mid += res[0].transcript);
      setInterim(fin + mid);
      if (fin.trim() && !sent) { sent = true; setInterim(""); ask(fin.trim(), heardAt); }
    };
    r.onerror = (e: any) => { if (e.error !== "no-speech" && e.error !== "aborted") add({ who: "info", text: `mic: ${e.error}` }); };
    r.onend = () => { setListening(false); setInterim(""); };
    rec.current = r;
    r.start();
    setListening(true);
  }

  const mic = () => {
    if (listening) { rec.current?.stop(); return; }
    listen();
  };

  return (
    <div style={panel} onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div ref={log} style={{ overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e, i) => (
          <div key={i} style={{ ...bubble, ...(e.who === "you" ? you : e.who === "info" ? info : {}) }}>{e.text}</div>
        ))}
        {interim && <div style={{ ...bubble, ...you, opacity: 0.6 }}>{interim}…</div>}
      </div>
      <form style={{ display: "flex", gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { ask(typed.trim()); setTyped(""); } }}>
        <button type="button" onClick={mic} title={listening ? "Stop listening" : "Talk (interrupts)"} style={{ ...micBtn, background: listening ? "#e5484d" : "#3b82f6" }}>
          {listening ? "■" : "🎤"}
        </button>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={listening ? "Listening…" : "…or type a question"} style={input} />
      </form>
      <div style={{ display: "flex", justifyContent: "space-between", color: "#888", fontSize: 11 }}>
        <label><input type="checkbox" checked={handsFree} onChange={(e) => setHandsFree(e.target.checked)} /> listen again after each answer</label>
        <span>{timing}</span>
      </div>
    </div>
  );
}

const panel: CSSProperties = {
  position: "fixed", left: 12, bottom: 56, width: 360, maxWidth: "calc(100vw - 24px)", height: "min(46vh, 420px)", zIndex: 1000,
  display: "flex", flexDirection: "column", gap: 8, padding: 10, background: "#fff", borderRadius: 12,
  boxShadow: "0 2px 12px #0002", font: "13px/1.4 system-ui, sans-serif", color: "#222",
};
const bubble: CSSProperties = { padding: "6px 10px", borderRadius: 10, background: "#f1f1f4", maxWidth: "88%", alignSelf: "flex-start" };
const you: CSSProperties = { background: "#3b82f6", color: "#fff", alignSelf: "flex-end" };
const info: CSSProperties = { background: "none", color: "#888", fontSize: 12, padding: 0 };
const micBtn: CSSProperties = { width: 36, height: 36, borderRadius: 18, border: "none", color: "#fff", fontSize: 16, cursor: "pointer", flex: "none" };
const input: CSSProperties = { flex: 1, minWidth: 0, border: "1px solid #ddd", borderRadius: 18, padding: "0 12px", font: "inherit" };
