// Preview player: scrub, play with narration, see sections and lint, live-reload on file changes.
import { evaluate } from "../engine/evaluate.js";
import { paint } from "../engine/paint.js";
import type { CScene } from "../engine/types.js";

interface ApiScene { id: string; scene: CScene | null; errors: string[]; issues: { level: string; rule: string; where: string; message: string; section?: string }[] }

/** A section's state, for its mark: not written yet, has errors, has warnings, or clean. */
function sectionState(s: ApiScene | undefined, span: CScene["spans"][number]): "missing" | "bad" | "warned" | "clean" {
  if (span.placeholder) return "missing";
  const mine = (e: string) => e.startsWith(span.id + ".") || e.startsWith(span.id + ":");
  if (s?.errors.some(mine) || s?.issues.some((i) => i.section === span.id && i.level === "error")) return "bad";
  return s?.issues.some((i) => i.section === span.id) ? "warned" : "clean";
}
const STATE_LABEL = { missing: "not written yet", bad: "has lint errors", warned: "has warnings", clean: "clean" };
interface Api { version: string; errors: string[]; scenes: ApiScene[] }

const $ = (id: string) => document.getElementById(id)!;
// Forward ?dir=… so the same player can show any output folder.
const Q = location.search;
let api: Api | null = null;
let scenes: CScene[] = [];
let offsets: number[] = [];
let total = 0;
let t = 0;
let playing = false;
let lastTick = 0;
const audios: (HTMLAudioElement | null)[] = [];

function locate(gt: number) {
  for (let i = scenes.length - 1; i >= 0; i--) if (gt >= offsets[i]) return { i, lt: Math.min(gt - offsets[i], scenes[i].duration) };
  return { i: 0, lt: 0 };
}

function draw() {
  if (!scenes.length) return;
  const { i, lt } = locate(t);
  const c = scenes[i];
  const f = evaluate(c, lt);
  // The stage takes the video's own shape (a vertical social cut is 9:16).
  const [W, H] = c.size, st = $("stage");
  if (st.style.aspectRatio !== `${W} / ${H}`) { st.style.aspectRatio = `${W} / ${H}`; st.style.maxWidth = `calc((100vh - 260px) * ${W} / ${H})`; }
  st.innerHTML = paint(c, f, "p");
  ($("scrub") as HTMLInputElement).value = String(t);
  $("time").textContent = `${t.toFixed(2)}s / ${total.toFixed(2)}s · ${c.id} · ${c.spans[f.section].id}`;
  const w = c.words.filter((w) => w.start <= lt && w.end + 1.2 > lt).map((w) => w.text).slice(-12).join(" ").replace(/ ([.,!?;:])/g, "$1");
  $("caption").textContent = w;
}

function syncAudio() {
  const { i, lt } = locate(t);
  audios.forEach((a, j) => {
    if (!a) return;
    if (j !== i || !playing) { if (!a.paused) a.pause(); return; }
    if (Math.abs(a.currentTime - lt) > 0.15) a.currentTime = lt;
    if (a.paused) a.play().catch(() => {});
  });
}

function tick(now: number) {
  if (playing) {
    const { i } = locate(t);
    const a = audios[i];
    if (a && !a.paused && a.currentTime > 0) t = offsets[i] + a.currentTime;
    else t += (now - lastTick) / 1000;
    if (t >= total) { t = total; playing = false; $("play").textContent = "Play"; }
    syncAudio();
    draw();
  }
  lastTick = now;
  requestAnimationFrame(tick);
}

function renderChrome() {
  if (!api) return;
  const marks = $("marks");
  marks.innerHTML = "";
  scenes.forEach((c, i) => c.spans.forEach((s) => {
    const el = document.createElement("div");
    const state = sectionState(api!.scenes.find((x) => x.id === c.id), s);
    el.className = `mark ${state}`;
    el.style.left = `${((offsets[i] + s.start) / total) * 100}%`;
    el.style.width = `${((s.end - s.start) / total) * 100}%`;
    el.title = `${c.id}/${s.id} (${STATE_LABEL[state]}): ${s.brief}`;
    el.textContent = `${c.id === scenes[0].id && scenes.length === 1 ? "" : c.id + "/"}${s.id}`;
    el.onclick = () => { t = offsets[i] + s.start + 0.001; syncAudio(); draw(); };
    marks.appendChild(el);
  }));
  const rows: string[] = [];
  for (const e of api.errors) rows.push(`<div class="err">✖ ${e}</div>`);
  for (const s of api.scenes) {
    for (const e of s.errors) rows.push(`<div class="err">✖ ${s.id}: ${e}</div>`);
    for (const i of s.issues) rows.push(`<div class="${i.level === "error" ? "err" : "warn"}">${i.level === "error" ? "✖" : "▲"} ${s.id} · ${i.rule} · ${i.where}: ${i.message}</div>`);
  }
  $("lint").innerHTML = rows.length ? rows.join("") : `<div class="ok">✓ no lint issues</div>`;
}

async function load() {
  const res = await fetch("/api/video" + Q);
  api = await res.json();
  scenes = api!.scenes.map((s) => s.scene).filter((s): s is CScene => !!s);
  offsets = [];
  total = 0;
  for (const c of scenes) { offsets.push(total); total += c.duration; }
  audios.forEach((a) => a?.pause());
  audios.length = 0;
  for (const c of scenes) {
    if (!c.audio) { audios.push(null); continue; }
    const a = new Audio(`${c.audio}${Q ? Q + "&" : "?"}v=${api!.version}`);
    a.preload = "auto";
    audios.push(a);
  }
  ($("scrub") as HTMLInputElement).max = String(total);
  t = Math.min(t, total);
  renderChrome();
  draw();
}

$("play").onclick = () => {
  playing = !playing;
  if (playing && t >= total) t = 0;
  $("play").textContent = playing ? "Pause" : "Play";
  syncAudio();
};
($("scrub") as HTMLInputElement).oninput = (e) => { t = Number((e.target as HTMLInputElement).value); syncAudio(); draw(); };
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") { e.preventDefault(); ($("play") as HTMLButtonElement).click(); }
  if (e.code === "ArrowRight") { t = Math.min(total, t + (e.shiftKey ? 1 : 1 / 30)); syncAudio(); draw(); }
  if (e.code === "ArrowLeft") { t = Math.max(0, t - (e.shiftKey ? 1 : 1 / 30)); syncAudio(); draw(); }
});

setInterval(async () => {
  try {
    const v = await (await fetch("/api/version" + Q)).text();
    if (api && v !== api.version) await load();
  } catch {}
}, 1000);

/**
 * #t=12.5 opens the player at that time (the labelling UI jumps to a section with it). A judge pin adds
 * &x=..&y=.. (a point) or &x&y&w&h (a box), as fractions of the frame, and the spot is outlined.
 */
function fromHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  if (q.has("t")) { t = Math.min(total, Math.max(0, Number(q.get("t")))); syncAudio(); draw(); }
  let pin = document.getElementById("pin");
  if (!pin) { pin = document.createElement("div"); pin.id = "pin"; $("stage").parentElement!.appendChild(pin); }
  if (!q.has("x")) { pin.style.display = "none"; return; }
  const stage = $("stage").getBoundingClientRect(), wrap = $("stage").parentElement!.getBoundingClientRect();
  const x = Number(q.get("x")), y = Number(q.get("y")), w = q.has("w") ? Number(q.get("w")) : 0, h = q.has("h") ? Number(q.get("h")) : 0;
  const r = w && h ? 0 : 22;
  Object.assign(pin.style, {
    display: "block", borderRadius: r ? "50%" : "6px",
    left: `${stage.left - wrap.left + x * stage.width - r}px`, top: `${stage.top - wrap.top + y * stage.height - r}px`,
    width: `${w ? w * stage.width : 2 * r}px`, height: `${h ? h * stage.height : 2 * r}px`,
  });
}
window.addEventListener("hashchange", fromHash);

load().then(() => {
  fromHash();
  requestAnimationFrame(tick);
});
