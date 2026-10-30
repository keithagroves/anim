// Score files: declarative music + foley written against the scene's own timeline (cues, sections,
// animations). compileScore turns one into a flat, sorted list of timed events for the synth.
import { z } from "zod";
import type { CScene } from "../engine/types.js";
import { bassNote, chord as parseChord, midi, voicing } from "./theory.js";
import { DRUMS, FX, VOICES, rng } from "./synth.js";

const Time = z.union([z.number(), z.string()]);
const Pitch = z.union([z.string(), z.number()]);
const Vel = z.number().min(0).max(127).optional();

/** `over: true` = not ducked under the narration (stingers and hits that should cut through). */
const Over = z.boolean().optional();
const Note = z.object({ note: Pitch, track: z.string(), at: Time, beats: z.number().optional(), dur: z.number().optional(), vel: Vel, over: Over }).strict();
const Chord = z.object({ chord: z.union([z.string(), z.array(Pitch).min(1)]), track: z.string(), at: Time, beats: z.number().optional(), dur: z.number().optional(), vel: Vel, strum: z.number().optional(), octave: z.number().int().optional(), over: Over }).strict();
const Pattern = z.object({ pattern: z.string(), track: z.string(), from: Time, to: Time, step: z.number().optional(), pitch: z.union([Pitch, z.array(Pitch).min(1)]), vel: Vel, beats: z.number().optional() }).strict();
const Drums = z.object({ drums: z.record(z.string()), from: Time, to: Time, step: z.number().optional(), vel: Vel }).strict();
const Hit = z.object({ drum: z.string(), at: Time, vel: Vel, over: Over }).strict();
const Progression = z.object({
  progression: z.array(z.string()).min(1), track: z.string(), from: Time, to: Time.optional(),
  bars: z.number().optional(), part: z.enum(["chord", "root", "arp", "fifths"]).optional(),
  rhythm: z.string().optional(), step: z.number().optional(), octave: z.number().int().optional(), vel: Vel,
}).strict();
const Run = z.object({ run: z.array(Pitch).min(1), track: z.string(), at: Time, step: z.number().optional(), vel: Vel, cresc: z.number().optional(), over: Over }).strict();
const Fx = z.object({ fx: z.string(), at: Time, dur: z.number().optional(), vel: Vel, pitch: z.number().optional(), pan: z.number().optional(), over: Over }).strict();
export const ScoreEvent = z.union([Note, Chord, Pattern, Drums, Hit, Progression, Run, Fx]);

const Program = z.union([z.string(), z.object({ patch: z.string(), gain: z.number().optional(), pan: z.number().optional(), rev: z.number().optional(), bright: z.number().optional() }).strict()]);

export const ScoreFile = z.object({
  seed: z.number().optional(),
  meter: z.number().int().optional(),
  tempo: z.union([
    z.object({ bpm: z.number(), t0: Time.optional() }).strict(),
    z.object({ fit: z.array(Time).min(2), range: z.tuple([z.number(), z.number()]).optional(), unit: z.enum(["bar", "beat"]).optional() }).strict(),
  ]),
  programs: z.record(Program).default({}),
  events: z.array(ScoreEvent).default([]),
  /** Sounds derived from the picture's own timeline (entrances, typing, counters). */
  foley: z.union([z.boolean(), z.object({ map: z.record(z.string()).optional(), vel: z.number().optional() }).strict()]).optional(),
  master: z.object({
    gain: z.number().optional(), fadeIn: z.number().optional(), fadeOut: z.number().optional(),
    /** dB the music drops under narration (default −10; 0 = no ducking). */
    duck: z.number().optional(),
    reverb: z.number().optional(),
  }).strict().optional(),
}).strict();
export type ScoreFile = z.infer<typeof ScoreFile>;

export type Ev =
  | { kind: "note"; track: string; t: number; m: number; dur: number; vel: number; over?: boolean }
  | { kind: "hit"; track: string; t: number; drum: string; vel: number; over?: boolean }
  | { kind: "fx"; track: string; t: number; name: string; dur: number; vel: number; pitch?: number; pan?: number; over?: boolean };

export interface TrackCfg { patch: string; gain: number; pan: number; rev: number; bright: number }

export interface CompiledScore {
  bpm: number; t0: number; meter: number; duration: number;
  tracks: Record<string, TrackCfg>;
  events: Ev[];
  master: { gain: number; fadeIn: number; fadeOut: number; duck: number; reverb: number };
  fit?: { anchor: string; t: number; offMs: number }[];
  errors: string[]; warnings: string[];
}

const FOLEY_DEFAULT: Record<string, string> = { pop: "pop", "pop-out": "pop", "fly-from": "whoosh", "type-on": "ticks", "count-up": "roll", "wipe-in": "swish" };

export function compileScore(file: ScoreFile, scene: CScene): CompiledScore {
  const errors: string[] = [], warnings: string[] = [];
  const meter = file.meter ?? 4, duration = scene.duration;
  const spans = Object.fromEntries(scene.spans.map((s) => [s.id, s]));
  const r = rng(file.seed ?? 7);

  // ---- time expressions ----
  // base: seconds | cue:name | <section> | <section>.end | start | end | beat:N | bar:N
  // then optional snap ~bar | ~beat | ~half, then offsets like +0.5 (s), -2b (beats), +1bar.
  let grid: { t0: number; B: number } | null = null;
  function time(x: string | number, where: string): number {
    if (typeof x === "number") return x;
    const m = x.match(/^(cue:[\w-]+|beat:-?[\d.]+|bar:-?[\d.]+|start|end|[A-Za-z][\w-]*(?:\.end)?)(~(?:bar|beat|half))?((?:[+-][\d.]+(?:bar|b)?)*)$/);
    if (!m) throw new Error(`${where}: bad time "${x}"`);
    const [, base, snap, offs] = m;
    let t: number;
    const needGrid = () => { if (!grid) throw new Error(`${where}: "${x}" needs the tempo grid, which isn't set yet (tempo.fit anchors can't use beats or bars)`); return grid; };
    if (base.startsWith("cue:")) { const c = scene.cues[base.slice(4)]; if (c === undefined) throw new Error(`${where}: unknown cue "${base}" (cues: ${Object.keys(scene.cues).join(", ")})`); t = c; }
    else if (base.startsWith("beat:")) { const g = needGrid(); t = g.t0 + Number(base.slice(5)) * g.B; }
    else if (base.startsWith("bar:")) { const g = needGrid(); t = g.t0 + Number(base.slice(4)) * meter * g.B; }
    else if (base === "start") t = 0;
    else if (base === "end") t = duration;
    else {
      const [id, end] = base.split(".");
      const s = spans[id];
      if (!s) throw new Error(`${where}: unknown section "${id}" (sections: ${Object.keys(spans).join(", ")})`);
      t = end ? s.end : s.start;
    }
    if (snap) {
      const g = needGrid(), unit = snap === "~bar" ? meter * g.B : snap === "~beat" ? g.B : g.B / 2;
      t = g.t0 + Math.round((t - g.t0) / unit) * unit;
    }
    for (const o of offs.match(/[+-][\d.]+(?:bar|b)?/g) ?? []) {
      const v = parseFloat(o);
      t += o.endsWith("bar") ? v * meter * needGrid().B : o.endsWith("b") ? v * needGrid().B : v;
    }
    return t;
  }

  // ---- tempo ----
  let bpm = 96, t0 = 0;
  let fit: CompiledScore["fit"];
  if ("bpm" in file.tempo) {
    bpm = file.tempo.bpm;
    try { t0 = file.tempo.t0 === undefined ? 0 : time(file.tempo.t0, "tempo.t0"); } catch (e: any) { errors.push(e.message); }
  } else {
    // Pick the tempo from the cut: the BPM (and phase) that puts bar lines closest to the anchors.
    const tf = file.tempo;
    const anchors: { a: string; t: number }[] = [];
    for (const a of tf.fit) { try { anchors.push({ a: String(a), t: time(a, "tempo.fit") }); } catch (e: any) { errors.push(e.message); } }
    const [lo, hi] = tf.range ?? [84, 112];
    const per = (b: number) => (60 / b) * (tf.unit === "beat" ? 1 : meter);
    let best = { cost: Infinity, bpm: lo, phase: 0 };
    for (let b = lo; b <= hi + 1e-9; b += 0.01) {
      const P = per(b);
      let sx = 0, sy = 0;
      for (const { t } of anchors) { sx += Math.cos((2 * Math.PI * t) / P); sy += Math.sin((2 * Math.PI * t) / P); }
      const phase = ((Math.atan2(sy, sx) / (2 * Math.PI)) * P + P) % P;
      let cost = 0;
      for (const { t } of anchors) { const d = ((((t - phase) % P) + P * 1.5) % P) - P / 2; cost += d * d; }
      if (cost < best.cost - 1e-9) best = { cost, bpm: b, phase };
    }
    bpm = Math.round(best.bpm * 100) / 100;
    const P = per(bpm), first = anchors[0]?.t ?? 0;
    // Bar 0 = the bar line nearest the first anchor.
    t0 = best.phase + Math.round((first - best.phase) / P) * P;
    fit = anchors.map(({ a, t }) => { const d = ((((t - t0) % P) + P * 1.5) % P) - P / 2; return { anchor: a, t, offMs: Math.round(d * 1000) }; });
  }
  const B = 60 / bpm;
  grid = { t0, B };
  const beats = (n: number) => n * B;

  // ---- tracks ----
  const tracks: Record<string, TrackCfg> = {};
  for (const [name, p] of Object.entries(file.programs)) {
    const c = typeof p === "string" ? { patch: p } : p;
    if (!VOICES[c.patch]) warnings.push(`program "${name}": unknown patch "${c.patch}", using marimba (patches: ${Object.keys(VOICES).join(", ")})`);
    tracks[name] = { patch: VOICES[c.patch] ? c.patch : "marimba", gain: c.gain ?? 0, pan: c.pan ?? 0, rev: c.rev ?? (c.patch === "pad" ? 0.55 : 0.22), bright: c.bright ?? 1 };
  }
  const ensure = (name: string, where: string) => {
    if (tracks[name]) return true;
    if (VOICES[name]) { tracks[name] = { patch: name, gain: 0, pan: 0, rev: name === "pad" ? 0.55 : 0.22, bright: 1 }; return true; }
    errors.push(`${where}: unknown track "${name}" (declare it in "programs", or name it after a patch: ${Object.keys(VOICES).join(", ")})`);
    return false;
  };
  tracks.drums ??= { patch: "drums", gain: 0, pan: 0, rev: 0.12, bright: 1 };
  tracks.fx ??= { patch: "fx", gain: 0, pan: 0, rev: 0.25, bright: 1 };

  const events: Ev[] = [];
  const hum = (t: number) => t + (r() - 0.5) * 0.012;
  const hv = (v: number) => Math.max(1, Math.min(127, v * (0.94 + r() * 0.12)));
  const dur = (e: { beats?: number; dur?: number }, def = 1) => e.dur ?? beats(e.beats ?? def);
  const pitchOf = (p: string | number, where: string) => { try { return midi(p); } catch (x: any) { errors.push(`${where}: ${x.message}`); return 60; } };

  /** Walk a step string over [from, to): calls hit(t, char, index, lengthInSteps) for x/X/o, `-` ties. */
  function steps(str: string, from: number, to: number, step: number, hit: (t: number, ch: string, k: number, len: number) => void) {
    const s = str.replace(/\s|\|/g, "");
    if (!s.length) return;
    const n = Math.floor((to - from) / (step * B) + 1e-6);
    for (let i = 0; i < n; i++) {
      const ch = s[i % s.length];
      if (ch !== "x" && ch !== "X" && ch !== "o") continue;
      let len = 1;
      while (i + len < n && s[(i + len) % s.length] === "-") len++;
      hit(from + i * step * B, ch, i, len);
    }
  }
  const accent = (ch: string, v: number) => (ch === "X" ? Math.min(127, v + 22) : ch === "o" ? v * 0.45 : v);

  file.events.forEach((e, i) => {
    const where = `events[${i}]`;
    try {
      if ("note" in e) {
        if (!ensure(e.track, where)) return;
        events.push({ kind: "note", track: e.track, t: time(e.at, where), m: pitchOf(e.note, where), dur: dur(e), vel: e.vel ?? 70, over: e.over });
      } else if ("chord" in e) {
        if (!ensure(e.track, where)) return;
        const t = time(e.at, where);
        const ms = typeof e.chord === "string" ? voicing(parseChord(e.chord)).map((m) => m + 12 * (e.octave ?? 0)) : e.chord.map((p) => pitchOf(p, where));
        ms.forEach((m, k) => events.push({ kind: "note", track: e.track, t: t + k * (e.strum ?? 0), m, dur: dur(e, meter), vel: (e.vel ?? 60) * (k === 0 ? 1 : 0.92), over: e.over }));
      } else if ("pattern" in e) {
        if (!ensure(e.track, where)) return;
        const ps = (Array.isArray(e.pitch) ? e.pitch : [e.pitch]).map((p) => pitchOf(p, where));
        let n = 0;
        const st = e.step ?? 0.5;
        steps(e.pattern, time(e.from, where), time(e.to, where), st, (t, ch, _k, len) => {
          events.push({ kind: "note", track: e.track, t: hum(t), m: ps[n++ % ps.length], dur: beats(e.beats ?? st * len * 0.9), vel: hv(accent(ch, e.vel ?? 64)) });
        });
      } else if ("drums" in e) {
        const from = time(e.from, where), to = time(e.to, where);
        for (const [drum, pat] of Object.entries(e.drums)) {
          if (!DRUMS[drum]) { errors.push(`${where}: unknown drum "${drum}" (drums: ${Object.keys(DRUMS).join(", ")})`); continue; }
          steps(pat, from, to, e.step ?? 0.5, (t, ch) => events.push({ kind: "hit", track: "drums", t: hum(t), drum, vel: hv(accent(ch, e.vel ?? 72)) }));
        }
      } else if ("drum" in e) {
        if (!DRUMS[e.drum]) { errors.push(`${where}: unknown drum "${e.drum}"`); return; }
        events.push({ kind: "hit", track: "drums", t: time(e.at, where), drum: e.drum, vel: e.vel ?? 80, over: e.over });
      } else if ("progression" in e) {
        if (!ensure(e.track, where)) return;
        const from = time(e.from, where), barLen = beats(meter) * (e.bars ?? 1);
        const chords = e.progression.map((c) => parseChord(c));
        const to = e.to === undefined ? from + barLen * chords.length : time(e.to, where);
        const part = e.part ?? "chord", st = e.step ?? 0.5, oct = 12 * (e.octave ?? 0);
        const rhythm = e.rhythm ?? "x" + "-".repeat(Math.max(0, Math.round(meter / st) - 1));
        let arp = 0;
        for (let k = 0, t = from; t < to - 1e-6; k++, t += barLen) {
          const c = chords[k % chords.length], end = Math.min(to, t + barLen);
          const v = voicing(c, part === "chord" ? 52 : 60).map((m) => m + oct), root = bassNote(c) + oct;
          // The rhythm repeats every bar inside the chord's span.
          for (let bt = t; bt < end - 1e-6; bt += beats(meter)) {
            steps(rhythm, bt, Math.min(end, bt + beats(meter)), st, (ht, ch, idx, len) => {
              const d = beats(st * len) * 0.95, vel = hv(accent(ch, e.vel ?? 60));
              if (part === "chord") v.forEach((m) => events.push({ kind: "note", track: e.track, t: hum(ht), m, dur: d, vel }));
              else if (part === "root") events.push({ kind: "note", track: e.track, t: hum(ht), m: root, dur: d, vel });
              else if (part === "fifths") events.push({ kind: "note", track: e.track, t: hum(ht), m: idx % 2 && c.tones.includes(7) ? root + 7 : root, dur: d, vel });
              else events.push({ kind: "note", track: e.track, t: hum(ht), m: v[arp++ % v.length], dur: d, vel });
            });
          }
        }
      } else if ("run" in e) {
        if (!ensure(e.track, where)) return;
        const t = time(e.at, where), st = e.step ?? 0.1;
        e.run.forEach((p, k) => events.push({ kind: "note", track: e.track, t: t + k * st, m: pitchOf(p, where), dur: st * 1.5, vel: Math.min(127, (e.vel ?? 50) + k * (e.cresc ?? 0)), over: e.over }));
      } else if ("fx" in e) {
        if (!FX[e.fx]) { errors.push(`${where}: unknown fx "${e.fx}" (fx: ${Object.keys(FX).join(", ")})`); return; }
        events.push({ kind: "fx", track: "fx", t: time(e.at, where), name: e.fx, dur: e.dur ?? 0.5, vel: e.vel ?? 64, pitch: e.pitch, pan: e.pan, over: e.over });
      }
    } catch (x: any) { errors.push(x.message); }
  });

  // ---- foley from the picture's timeline ----
  if (file.foley) {
    const cfg = typeof file.foley === "object" ? file.foley : {};
    const map = { ...FOLEY_DEFAULT, ...(cfg.map ?? {}) }, fv = cfg.vel ?? 46;
    let lastPop = -1, popRun = 0;
    const anims = [...scene.anims.flat(), ...scene.through].sort((a, b) => a.start - b.start);
    for (const a of anims) {
      const kind = map[a.preset];
      if (!kind || kind === "none") continue;
      const o = scene.objects[a.target];
      if (kind === "ticks") {
        const chars = (o?.def.text ?? "").replace(/\s/g, "").length;
        const n = Math.min(chars, Math.floor(a.dur * 24));
        for (let k = 0; k < n; k++) events.push({ kind: "fx", track: "fx", t: a.start + (k / Math.max(1, n)) * a.dur, name: "tick", dur: 0, vel: fv * 0.5 });
      } else if (kind === "roll") {
        events.push({ kind: "fx", track: "fx", t: a.start, name: "roll", dur: a.dur, vel: fv });
      } else if (kind === "pop") {
        // Consecutive pops climb in pitch, so a staggered list reads as a little run.
        popRun = a.start - lastPop < 0.45 ? popRun + 1 : 0;
        lastPop = a.start;
        events.push({ kind: "fx", track: "fx", t: a.start, name: "pop", dur: 0, vel: fv * (a.preset === "pop-out" ? 0.6 : 0.9), pitch: (a.preset === "pop-out" ? 230 : 300) * 1.08 ** Math.min(popRun, 8) });
      } else if (FX[kind]) {
        events.push({ kind: "fx", track: "fx", t: a.start, name: kind, dur: a.dur, vel: fv * 0.8 });
      } else warnings.push(`foley.map: unknown fx "${kind}" for ${a.preset}`);
    }
  }

  // ---- bounds ----
  const kept: Ev[] = [];
  for (const ev of events) {
    if (ev.t < -0.1) { warnings.push(`${ev.kind} at ${ev.t.toFixed(2)}s is before 0; dropped`); continue; }
    if (ev.t > duration) { warnings.push(`${ev.kind} at ${ev.t.toFixed(2)}s is after the scene ends (${duration.toFixed(2)}s); dropped`); continue; }
    kept.push({ ...ev, t: Math.max(0, ev.t) });
  }
  kept.sort((a, b) => a.t - b.t);

  const ms = file.master ?? {};
  return {
    bpm, t0, meter, duration, tracks, events: kept, fit, errors, warnings,
    master: { gain: ms.gain ?? -6, fadeIn: ms.fadeIn ?? 0, fadeOut: ms.fadeOut ?? 1.2, duck: ms.duck ?? -10, reverb: ms.reverb ?? 0.84 },
  };
}
