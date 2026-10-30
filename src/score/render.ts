// Compiled score → stereo music, ducked under the narration and mixed with it.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { Words } from "../engine/types.js";
import type { CompiledScore } from "./score.js";
import { DRUMS, FX, SR, VOICES, reverb, rng } from "./synth.js";

/** Default stereo placement for drums: some width, nothing hard-panned. */
const DRUM_PAN: Record<string, number> = { hat: 0.25, openhat: 0.25, shaker: -0.3, tamb: -0.25, ride: 0.3, crash: -0.2, woodblock: 0.2, cowbell: -0.15, tom: -0.1 };

const db = (x: number) => 10 ** (x / 20);
/** Velocity → amplitude, with a curve so vel 30 is a quiet bed and vel 110 a hit. */
const amp = (vel: number) => (Math.max(0, Math.min(127, vel)) / 127) ** 1.5;

export interface Rendered { L: Float32Array; R: Float32Array }
/** `bed` ducks under the narration; `over` (events marked over: true) doesn't. */
export interface Music { bed: Rendered; over: Rendered }

export function renderMusic(sc: CompiledScore, seed = 7): Music {
  return { bed: renderBus(sc, seed, false), over: renderBus(sc, seed, true) };
}

function renderBus(sc: CompiledScore, seed: number, over: boolean): Rendered {
  const n = Math.ceil(sc.duration * SR);
  const tail = n + 3 * SR;
  const dryL = new Float32Array(tail), dryR = new Float32Array(tail), sendL = new Float32Array(tail), sendR = new Float32Array(tail);
  const r = rng(seed * 7919 + 1);

  const place = (b: Float32Array, t: number, gain: number, pan: number, rev: number) => {
    const o = Math.round(t * SR);
    const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    const gl = Math.cos(a) * gain * Math.SQRT2, gr = Math.sin(a) * gain * Math.SQRT2;
    for (let i = 0; i < b.length; i++) {
      const j = o + i;
      if (j < 0) continue;
      if (j >= tail) break;
      dryL[j] += b[i] * gl; dryR[j] += b[i] * gr;
      if (rev) { sendL[j] += b[i] * gl * rev; sendR[j] += b[i] * gr * rev; }
    }
  };

  for (const ev of sc.events) {
    if (!!ev.over !== over) continue;
    const tr = sc.tracks[ev.track];
    const g = db(tr.gain) * amp(ev.vel);
    if (ev.kind === "note") {
      const b = VOICES[tr.patch]({ m: ev.m, dur: ev.dur, vel: amp(ev.vel) ** 0.3, bright: tr.bright, r });
      place(b, ev.t, g, tr.pan, tr.rev);
    } else if (ev.kind === "hit") {
      place(DRUMS[ev.drum]({ vel: 1, r }), ev.t, g, DRUM_PAN[ev.drum] ?? tr.pan, tr.rev);
    } else {
      const { buf, offset } = FX[ev.name]({ vel: 1, dur: ev.dur, r, pitch: ev.pitch });
      place(buf, ev.t + offset, g, ev.pan ?? tr.pan, tr.rev);
    }
  }

  const [wL, wR] = reverb(sendL, sendR, sc.master.reverb);
  const L = new Float32Array(n), R = new Float32Array(n), mg = db(sc.master.gain);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fade = Math.min(1, sc.master.fadeIn > 0 ? t / sc.master.fadeIn : 1, sc.master.fadeOut > 0 ? (sc.duration - t) / sc.master.fadeOut : 1);
    L[i] = (dryL[i] + wL[i] * 0.9) * mg * Math.max(0, fade);
    R[i] = (dryR[i] + wR[i] * 0.9) * mg * Math.max(0, fade);
  }
  return { L, R };
}

/** Gain curve that drops the music by `duckDb` while the narrator speaks (smooth in and out). */
export function duckCurve(words: Words["words"], duration: number, duckDb: number): Float32Array {
  const n = Math.ceil(duration * SR), target = new Float32Array(n).fill(1);
  if (!duckDb) return target;
  // Speech regions: words merged across short gaps, opened a little early and held a little late.
  const regions: [number, number][] = [];
  for (const w of words) {
    if (!/\w/.test(w.text)) continue;
    const last = regions[regions.length - 1];
    if (last && w.start - last[1] < 0.45) last[1] = w.end; else regions.push([w.start, w.end]);
  }
  const low = db(duckDb);
  for (const [a, b] of regions) for (let i = Math.max(0, Math.floor((a - 0.08) * SR)); i < Math.min(n, (b + 0.25) * SR); i++) target[i] = low;
  // One-pole smoothing: ~120 ms down, ~450 ms back up.
  const out = new Float32Array(n), kd = 1 - Math.exp(-1 / (0.12 * SR)), ku = 1 - Math.exp(-1 / (0.45 * SR));
  let g = target[0];
  for (let i = 0; i < n; i++) { const k = target[i] < g ? kd : ku; g += (target[i] - g) * k; out[i] = g; }
  return out;
}

/** Narration resampled to 48 kHz mono float. */
export function readVoice(path: string, duration: number): Float32Array {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const v = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const out = new Float32Array(Math.ceil(duration * SR));
  out.set(v.subarray(0, out.length));
  return out;
}

export function mix(music: Music, duck: Float32Array, voice?: Float32Array): Rendered {
  const { bed, over } = music, n = bed.L.length, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = voice ? voice[i] ?? 0 : 0;
    L[i] = soft(bed.L[i] * duck[i] + over.L[i] + v);
    R[i] = soft(bed.R[i] * duck[i] + over.R[i] + v);
  }
  return { L, R };
}

/** Transparent below −3 dBFS, then rounds off peaks instead of clipping. */
function soft(x: number) {
  const th = 0.7, a = Math.abs(x);
  return a <= th ? x : Math.sign(x) * (th + (1 - th) * Math.tanh((a - th) / (1 - th)));
}

export function writeWav(path: string, { L, R }: Rendered) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(SR, 24);
  b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(path, b);
}

/** RMS dBFS per second (−60 silent, about −30 a quiet bed, −20 a groove, −12 a hit). */
export function levels({ L, R }: Rendered): number[] {
  const out: number[] = [];
  for (let s = 0; s * SR < L.length; s++) {
    let sum = 0, c = 0;
    for (let i = s * SR; i < Math.min(L.length, (s + 1) * SR); i++) { sum += L[i] * L[i] + R[i] * R[i]; c += 2; }
    out.push(Math.max(-60, 10 * Math.log10(sum / Math.max(1, c) + 1e-12)));
  }
  return out;
}
