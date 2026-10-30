export type Ease = (p: number) => number;

/** Back-out with overshoot strength k (1.70158 is the classic value: about 10% past the target). */
export const backOut = (k = 1.70158): Ease => (p) => {
  const c3 = k + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + k * Math.pow(p - 1, 2);
};

/** Damped spring that overshoots about 11%, rings once and lands exactly on 1 at p = 1. */
const spring: Ease = (p) => (p >= 1 ? 1 : 1 - Math.exp(-5 * p) * Math.cos(2.5 * Math.PI * p) * (1 - p));

/** CSS cubic-bezier(x1, y1, x2, y2) as an easing (solved for x by Newton steps, then bisection). */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const dx = (t: number, a: number, b: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 6; i++) { const d = dx(t, x1, x2); if (Math.abs(d) < 1e-6) break; t -= (cx(t, x1, x2) - p) / d; }
    if (t < 0 || t > 1 || Math.abs(cx(t, x1, x2) - p) > 1e-4) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 40; i++) { t = (lo + hi) / 2; if (cx(t, x1, x2) < p) lo = t; else hi = t; }
    }
    return cx(t, y1, y2);
  };
}

export const EASES: Record<string, Ease> = {
  linear: (p) => p,
  in: (p) => p * p * p,
  out: (p) => 1 - Math.pow(1 - p, 3),
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  expoOut: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  back: backOut(),
  spring,
  sine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
  /** Walkthrough camera: arrivals cubic-bezier(.22,.7,.24,1), repositioning (.45,0,.2,1). */
  arrive: bezier(0.22, 0.7, 0.24, 1),
  glide: bezier(0.45, 0, 0.2, 1),
};

/** Eases that overshoot their target (lint: never on product UI). */
export const BOUNCY = new Set(["back", "spring"]);

export function ease(name: string | undefined, fallback: string, params?: { overshoot?: number }): Ease {
  const key = name ?? fallback;
  if (key === "back" && params?.overshoot !== undefined) return backOut(params.overshoot);
  const e = EASES[key];
  if (!e) throw new Error(`unknown ease "${name}" (have: ${Object.keys(EASES).join(", ")})`);
  return e;
}

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
