// A small deterministic synth: no samples. Every voice renders one note into a mono buffer;
// the mixer pans, sends to a shared reverb and sums. Same events + same seed → same samples.
import { hz } from "./theory.js";

export const SR = 48000;
const TAU = Math.PI * 2;
const NYQ = SR / 2;

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- DSP primitives ----------

/** RBJ biquad; `set` can be called per sample for sweeps. */
class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; x1 = 0; x2 = 0; y1 = 0; y2 = 0;
  set(type: "lp" | "hp" | "bp", f: number, q: number) {
    const w = (TAU * Math.min(f, NYQ * 0.95)) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
    else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
    return this;
  }
  run(x: number) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const buf = (sec: number) => new Float32Array(Math.max(1, Math.ceil(sec * SR)));
const env = (t: number, tau: number) => Math.exp(-t / tau);
const att = (t: number, a: number) => (a <= 0 ? 1 : 1 - Math.exp(-t / a));
/** Note-off release: 1 while held, then decays with `tau`. */
const rel = (t: number, dur: number, tau: number) => (t < dur ? 1 : Math.exp(-(t - dur) / tau));

/** Sum of decaying sine partials (mallets, bells). */
function partials(f: number, len: number, parts: [ratio: number, amp: number, tau: number][], o: { attack?: number; dur?: number; damp?: number } = {}) {
  const out = buf(len);
  for (const [r, a, tau] of parts) {
    const pf = f * r;
    if (pf >= NYQ * 0.9) continue;
    const w = (TAU * pf) / SR;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      out[i] += a * Math.sin(w * i) * env(t, tau) * (o.damp ? rel(t, o.dur!, o.damp) : 1);
    }
  }
  const A = o.attack ?? 0.0015;
  for (let i = 0; i < out.length; i++) out[i] *= att(i / SR, A);
  return out;
}

/** One cycle of a band-limited waveform from harmonic amplitudes, for fast wavetable playback. */
function table(amps: number[]) {
  const N = 2048, t = new Float32Array(N + 1);
  amps.forEach((a, k) => { if (a) for (let i = 0; i <= N; i++) t[i] += a * Math.sin((TAU * (k + 1) * i) / N); });
  let peak = 0;
  for (const v of t) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i <= N; i++) t[i] /= peak || 1;
  return t;
}
function osc(out: Float32Array, tab: Float32Array, f: number, gain: (i: number) => number, phase0 = 0) {
  const N = tab.length - 1, inc = (f * N) / SR;
  let ph = phase0 * N;
  for (let i = 0; i < out.length; i++) {
    const k = ph | 0, fr = ph - k;
    out[i] += (tab[k] + (tab[k + 1] - tab[k]) * fr) * gain(i);
    ph += inc;
    if (ph >= N) ph -= N;
  }
}

// ---------- pitched voices ----------

export interface NoteIn { m: number; dur: number; vel: number; bright: number; r: () => number }
type Voice = (n: NoteIn) => Float32Array;

const scaleTau = (f: number, base: number, ref = 261.6, k = 0.5) => base * (ref / f) ** k;

export const VOICES: Record<string, Voice> = {
  marimba: ({ m, vel, bright }) => {
    const f = hz(m), tau = Math.min(0.9, Math.max(0.08, scaleTau(f, 0.42, 261.6, 0.6)));
    const out = partials(f, tau * 5 + 0.05, [[1, 1, tau], [3.93, 0.28 * bright, tau * 0.22], [9.2, 0.07 * bright, tau * 0.08]]);
    for (let i = 0; i < 120; i++) out[i] += (Math.sin(i * 1.7) * 0.06 * Math.exp(-i / 30)) * bright;
    return mul(out, 0.8 * vel);
  },
  vibes: ({ m, vel, dur, bright }) => {
    const f = hz(m);
    const out = partials(f, Math.min(dur, 3) + 1.2, [[1, 1, 1.8], [4, 0.18 * bright, 0.5], [10, 0.04 * bright, 0.08]], { dur: dur + 0.15, damp: 0.25, attack: 0.003 });
    for (let i = 0; i < out.length; i++) out[i] *= 1 + 0.22 * Math.sin((TAU * 5.2 * i) / SR);
    return mul(out, 0.6 * vel);
  },
  glock: ({ m, vel, bright }) => {
    const f = hz(m), tau = scaleTau(f, 1.1, 1046, 0.4);
    return mul(partials(f, tau * 4, [[1, 1, tau], [2.76, 0.35 * bright, tau * 0.4], [5.4, 0.15 * bright, tau * 0.2], [8.93, 0.06, tau * 0.1]], { attack: 0.0008 }), 0.45 * vel);
  },
  pluck: ({ m, vel, bright }) => {
    const f = hz(m), tau = scaleTau(f, 0.85, 440, 0.3);
    const out = partials(f, tau * 4.5, [[1, 1, tau], [5.4, 0.16 * bright, tau * 0.18], [10.3, 0.05 * bright, tau * 0.06]], { attack: 0.001 });
    return mul(out, 0.75 * vel);
  },
  ep: ({ m, vel, dur, bright }) => {
    // Two-operator FM "tine" piano: the modulation index decays, so the attack is bright and the tail round.
    const f = hz(m), len = Math.min(dur, 4) + 0.6, out = buf(len);
    const w = (TAU * f) / SR, tine = 14 * f < NYQ * 0.9 ? (TAU * 14 * f) / SR : 0;
    const dTau = scaleTau(f, 1.7, 261.6, 0.45), idx0 = (0.5 + 1.6 * vel) * bright;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR, I = idx0 * env(t, 0.45) + 0.22;
      const a = att(t, 0.002) * env(t, dTau) * rel(t, dur, 0.12) * (1 + 0.08 * Math.sin(TAU * 4.6 * t));
      out[i] = a * (Math.sin(w * i + I * Math.sin(w * i)) + (tine ? 0.14 * vel * Math.sin(tine * i) * env(t, 0.04) : 0));
    }
    return mul(out, 0.55 * vel);
  },
  keys: ({ m, vel, dur, bright, r }) => {
    const f = hz(m), len = Math.min(dur, 6) + 0.4, out = buf(len);
    const tab = table([1, 0, 1 / 9 + 0.05 * bright, 0, 1 / 25, 0, 1 / 49]);
    const g = (i: number) => { const t = i / SR; return att(t, 0.015) * (0.7 + 0.3 * env(t, 0.5)) * rel(t, dur, 0.25); };
    osc(out, tab, f * 2 ** (4 / 1200), g, r());
    osc(out, tab, f * 2 ** (-4 / 1200), g, r());
    return mul(out, 0.32 * vel);
  },
  bass: ({ m, vel, dur }) => {
    // Round fingered bass: sine body, a little 2nd/3rd harmonic on the attack, soft saturation.
    const f = hz(m), len = Math.min(dur, 4) + 0.2, out = buf(len), w = (TAU * f) / SR;
    for (let i = 0; i < out.length; i++) {
      const t = i / SR;
      const s = Math.sin(w * i) + 0.35 * Math.sin(2 * w * i) * env(t, 0.15) + 0.12 * Math.sin(3 * w * i) * env(t, 0.07);
      const a = att(t, 0.004) * (0.55 + 0.45 * env(t, 0.35)) * rel(t, dur, 0.07);
      out[i] = Math.tanh(1.3 * s * a) / Math.tanh(1.3);
    }
    return mul(out, 0.85 * vel);
  },
  pad: ({ m, vel, dur, bright, r }) => {
    // Three detuned, low-passed saws from wavetables; slow attack and release.
    const f = hz(m), len = dur + 1.6, out = buf(len), cut = 1100 * bright;
    const amps = Array.from({ length: Math.max(1, Math.min(40, Math.floor(8000 / f))) }, (_, k) => (1 / (k + 1)) / (1 + ((k + 1) * f / cut) ** 2));
    const tab = table(amps), A = Math.min(0.8, dur / 3);
    const g = (i: number) => { const t = i / SR; return att(t, A) * rel(t, dur, 0.9); };
    for (const c of [-8, 0, 7]) osc(out, tab, f * 2 ** (c / 1200), g, r());
    return mul(out, 0.22 * vel);
  },
};

function mul(b: Float32Array, k: number) { for (let i = 0; i < b.length; i++) b[i] *= k; return b; }

function noiseBurst(len: number, r: () => number, filt: (i: number) => [Biquad, number] | null, amp: (t: number) => number) {
  const out = buf(len);
  for (let i = 0; i < out.length; i++) {
    let x = r() * 2 - 1;
    const f = filt(i);
    if (f) x = f[0].run(x) * f[1];
    out[i] = x * amp(i / SR);
  }
  return out;
}
const sine = (len: number, fr: (t: number) => number, amp: (t: number) => number) => {
  const out = buf(len);
  let ph = 0;
  for (let i = 0; i < out.length; i++) { const t = i / SR; out[i] = Math.sin(ph) * amp(t); ph += (TAU * fr(t)) / SR; }
  return out;
};
const add = (a: Float32Array, b: Float32Array, at = 0, k = 1) => { const o = Math.round(at * SR); for (let i = 0; i < b.length && o + i < a.length; i++) a[o + i] += b[i] * k; return a; };

// ---------- drums (one hit) ----------

export interface HitIn { vel: number; r: () => number; pitch?: number }
type Hit = (h: HitIn) => Float32Array;

export const DRUMS: Record<string, Hit> = {
  kick: ({ vel, r }) => {
    const b = sine(0.55, (t) => 44 + 96 * env(t, 0.035), (t) => env(t, 0.3) * att(t, 0.001));
    for (let i = 0; i < 160; i++) b[i] += (r() * 2 - 1) * 0.25 * Math.exp(-i / 40);
    return mul(b, 0.95 * vel);
  },
  snare: ({ vel, r }) => {
    const bp = new Biquad().set("bp", 1900, 0.7);
    return mul(add(noiseBurst(0.35, r, () => [bp, 1.6], (t) => env(t, 0.11)), sine(0.2, () => 185, (t) => env(t, 0.05)), 0, 0.5), 0.6 * vel);
  },
  clap: ({ vel, r }) => {
    const bp = new Biquad().set("bp", 1200, 0.9);
    const amp = (t: number) => [0, 0.011, 0.022].reduce((a, o) => a + (t >= o ? Math.exp(-(t - o) / 0.006) : 0), 0) * 0.6 + (t > 0.022 ? 0.5 * env(t - 0.022, 0.09) : 0);
    return mul(noiseBurst(0.35, r, () => [bp, 1.8], amp), 0.55 * vel);
  },
  sidestick: ({ vel, r }) => {
    const bp = new Biquad().set("bp", 2200, 3);
    return mul(add(noiseBurst(0.12, r, () => [bp, 3], (t) => env(t, 0.018)), sine(0.08, () => 420, (t) => env(t, 0.012)), 0, 0.6), 0.55 * vel);
  },
  hat: ({ vel, r }) => {
    const hp = new Biquad().set("hp", 7500, 0.7);
    return mul(noiseBurst(0.09, r, () => [hp, 1], (t) => env(t, 0.032)), 0.3 * vel);
  },
  openhat: ({ vel, r }) => {
    const hp = new Biquad().set("hp", 7000, 0.7);
    return mul(noiseBurst(0.6, r, () => [hp, 1], (t) => env(t, 0.22)), 0.26 * vel);
  },
  shaker: ({ vel, r }) => {
    const bp = new Biquad().set("bp", 5800, 1.2);
    return mul(noiseBurst(0.14, r, () => [bp, 1.4], (t) => att(t, 0.018) * env(t, 0.045)), 0.32 * vel);
  },
  tamb: ({ vel, r }) => {
    const hp = new Biquad().set("hp", 6000, 1);
    return mul(add(noiseBurst(0.25, r, () => [hp, 1], (t) => env(t, 0.1)), partials(7200, 0.2, [[1, 1, 0.06], [1.37, 0.6, 0.05]]), 0, 0.15), 0.3 * vel);
  },
  woodblock: ({ vel, pitch }) => mul(partials(pitch ?? 1050, 0.12, [[1, 1, 0.03], [2.6, 0.4, 0.015]], { attack: 0.0005 }), 0.5 * vel),
  cowbell: ({ vel }) => {
    const bp = new Biquad().set("bp", 700, 1.5);
    const b = buf(0.4);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR, sq = (f: number) => Math.sign(Math.sin(TAU * f * t));
      b[i] = bp.run(sq(545) + sq(815)) * env(t, 0.13);
    }
    return mul(b, 0.3 * vel);
  },
  tom: ({ vel }) => mul(sine(0.5, (t) => 92 + 50 * env(t, 0.05), (t) => env(t, 0.24)), 0.7 * vel),
  crash: ({ vel, r }) => {
    const hp = new Biquad().set("hp", 4500, 0.7);
    return mul(noiseBurst(2.4, r, () => [hp, 1], (t) => env(t, 0.9) * att(t, 0.002)), 0.28 * vel);
  },
  ride: ({ vel, r }) => {
    const hp = new Biquad().set("hp", 6000, 0.7);
    return mul(add(noiseBurst(1.2, r, () => [hp, 1], (t) => env(t, 0.5)), partials(5200, 1, [[1, 1, 0.4], [1.48, 0.7, 0.3]]), 0, 0.05), 0.18 * vel);
  },
};

// ---------- foley ----------

export interface FxIn { vel: number; dur: number; r: () => number; pitch?: number }
type Fx = (f: FxIn) => { buf: Float32Array; offset: number };

function sweepNoise(len: number, r: () => number, f0: number, f1: number, q: number, amp: (p: number) => number) {
  const bp = new Biquad();
  const out = buf(len), n = out.length;
  for (let i = 0; i < n; i++) {
    const p = i / n;
    if (i % 32 === 0) bp.set("bp", f0 * (f1 / f0) ** p, q);
    out[i] = bp.run(r() * 2 - 1) * amp(p) * 2.2;
  }
  return out;
}
const bell = (m: number, vel: number) => mul(partials(hz(m), 1.6, [[1, 1, 0.7], [2.76, 0.3, 0.25], [5.4, 0.1, 0.1]], { attack: 0.0008 }), 0.4 * vel);

export const FX: Record<string, Fx> = {
  tick: ({ vel, r, pitch }) => ({ buf: DRUMS.woodblock({ vel: vel * 0.8, r, pitch: (pitch ?? 1450) * (0.92 + 0.16 * r()) }), offset: 0 }),
  click: ({ vel, r }) => ({ buf: mul(DRUMS.sidestick({ vel, r }), 0.8), offset: 0 }),
  doubleclick: ({ vel, r }) => ({ buf: add(mul(DRUMS.sidestick({ vel, r }), 0.8), DRUMS.sidestick({ vel: vel * 0.85, r }), 0.09, 0.8), offset: 0 }),
  pop: ({ vel, pitch }) => {
    const f0 = pitch ?? 320;
    return { buf: mul(sine(0.09, (t) => f0 + f0 * 2.6 * Math.min(1, t / 0.02), (t) => att(t, 0.001) * env(t, 0.028)), 0.5 * vel), offset: 0 };
  },
  ding: ({ vel, pitch }) => {
    const m = pitch ?? 88;
    return { buf: add(bell(m, vel), bell(m + 7, vel * 0.8), 0.11), offset: 0 };
  },
  chime: ({ vel, pitch }) => {
    const m = pitch ?? 84, b = buf(1.9);
    [0, 4, 7, 12].forEach((iv, k) => add(b, bell(m + iv, vel * (0.75 + k * 0.08)), k * 0.075));
    return { buf: b, offset: 0 };
  },
  sparkle: ({ vel, r, pitch }) => {
    const m = pitch ?? 86, b = buf(1.6), penta = [0, 2, 4, 7, 9, 12, 14, 16];
    for (let k = 0; k < 6; k++) add(b, bell(m + penta[Math.floor(r() * penta.length)], vel * 0.5), k * 0.06 + r() * 0.02);
    return { buf: b, offset: 0 };
  },
  whoosh: ({ vel, dur, r }) => ({ buf: sweepNoise(Math.max(0.15, dur), r, 380, 2600, 1.4, (p) => Math.sin(Math.PI * p) ** 1.6 * 0.5 * vel), offset: 0 }),
  /** Swells INTO its time: starts `dur` before it. */
  revswell: ({ vel, dur, r }) => ({ buf: sweepNoise(Math.max(0.2, dur), r, 300, 4200, 1.1, (p) => p ** 3 * 0.55 * vel), offset: -Math.max(0.2, dur) }),
  swish: ({ vel, dur, r }) => ({ buf: sweepNoise(Math.max(0.12, Math.min(dur, 0.5)), r, 1800, 5200, 1.6, (p) => Math.sin(Math.PI * p) * 0.18 * vel), offset: 0 }),
  /** Accelerating ticks over `dur`, landing on a ding. */
  roll: ({ vel, dur, r, pitch }) => {
    const D = Math.max(0.2, dur), b = buf(D + 1.7);
    let t = 0, gap = 0.12;
    while (t < D - 0.02) { add(b, DRUMS.woodblock({ vel: vel * (0.35 + 0.4 * (t / D)), r, pitch: 1300 + 500 * (t / D) }), t); t += gap; gap = Math.max(0.028, gap * 0.86); }
    const m = pitch ?? 88;
    add(b, add(bell(m, vel), bell(m + 7, vel * 0.8), 0.1), D);
    return { buf: b, offset: 0 };
  },
  boing: ({ vel, pitch }) => {
    const f0 = pitch ?? 210;
    return { buf: mul(sine(0.45, (t) => f0 * (1 + 0.35 * Math.sin(TAU * 11 * t) * env(t, 0.12)), (t) => att(t, 0.002) * env(t, 0.16)), 0.5 * vel), offset: 0 };
  },
  thud: ({ vel, r }) => ({ buf: mul(add(sine(0.35, (t) => 70 + 30 * env(t, 0.02), (t) => env(t, 0.12)), DRUMS.tom({ vel: 0.4, r }), 0, 0.4), 0.7 * vel), offset: 0 }),
};

// ---------- reverb (Freeverb) ----------

export function reverb(L: Float32Array, R: Float32Array, room = 0.84, damp = 0.28) {
  const k = SR / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], aps = [556, 441, 341, 225];
  const outL = new Float32Array(L.length), outR = new Float32Array(R.length);
  for (const [inp, out, spread] of [[L, outL, 0], [R, outR, 23]] as const) {
    const cb = combs.map((d) => ({ b: new Float32Array(Math.round((d + spread) * k)), i: 0, lp: 0 }));
    const ab = aps.map((d) => ({ b: new Float32Array(Math.round((d + spread) * k)), i: 0 }));
    for (let n = 0; n < inp.length; n++) {
      const x = inp[n] * 0.015;
      let y = 0;
      for (const c of cb) {
        const o = c.b[c.i];
        c.lp = o * (1 - damp) + c.lp * damp;
        c.b[c.i] = x + c.lp * room;
        if (++c.i >= c.b.length) c.i = 0;
        y += o;
      }
      for (const a of ab) {
        const o = a.b[a.i];
        a.b[a.i] = y + o * 0.5;
        if (++a.i >= a.b.length) a.i = 0;
        y = o - y;
      }
      out[n] = y;
    }
  }
  return [outL, outR] as const;
}
