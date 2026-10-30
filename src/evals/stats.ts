/** 95% Wilson score interval for k successes out of n. */
export function wilson(k: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: NaN, lo: NaN, hi: NaN };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Deterministic PRNG so bootstrap results are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paired bootstrap over cases: each case has a candidate and a baseline score (e.g. pass rate over trials).
 * Returns the mean difference (candidate − baseline) and its 95% interval.
 */
export function pairedBootstrap(pairs: [number, number][], iters = 5000, seed = 7): { diff: number; lo: number; hi: number } {
  if (!pairs.length) return { diff: NaN, lo: NaN, hi: NaN };
  const diffs = pairs.map(([a, b]) => a - b);
  const r = rng(seed);
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    let sum = 0;
    for (let j = 0; j < diffs.length; j++) sum += diffs[Math.floor(r() * diffs.length)];
    samples.push(sum / diffs.length);
  }
  return { diff: mean(diffs), lo: quantile(samples, 0.025), hi: quantile(samples, 0.975) };
}

export interface Agreement {
  n: number;
  agreement: number;
  kappa: number;
  /** Of the outputs humans failed, the share the judge also failed. */
  failRecall: number;
  /** Of the outputs humans passed, the share the judge also passed. */
  passRecall: number;
  confusion: { hp_jp: number; hp_jf: number; hf_jp: number; hf_jf: number };
}

/** Judge vs human agreement on binary verdicts (true = pass). */
export function agreement(pairs: { human: boolean; judge: boolean }[]): Agreement {
  const c = { hp_jp: 0, hp_jf: 0, hf_jp: 0, hf_jf: 0 };
  for (const { human, judge } of pairs) {
    if (human && judge) c.hp_jp++;
    else if (human && !judge) c.hp_jf++;
    else if (!human && judge) c.hf_jp++;
    else c.hf_jf++;
  }
  const n = pairs.length;
  const po = n ? (c.hp_jp + c.hf_jf) / n : NaN;
  const pHumanPass = n ? (c.hp_jp + c.hp_jf) / n : 0, pJudgePass = n ? (c.hp_jp + c.hf_jp) / n : 0;
  const pe = pHumanPass * pJudgePass + (1 - pHumanPass) * (1 - pJudgePass);
  const kappa = pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return {
    n, agreement: po, kappa,
    failRecall: c.hf_jf + c.hf_jp ? c.hf_jf / (c.hf_jf + c.hf_jp) : NaN,
    passRecall: c.hp_jp + c.hp_jf ? c.hp_jp / (c.hp_jp + c.hp_jf) : NaN,
    confusion: c,
  };
}

/** Pearson correlation; used to spot judge size bias. */
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

export const pct = (v: number) => (Number.isNaN(v) ? "–" : `${(v * 100).toFixed(0)}%`);
export const ci = (w: { p: number; lo: number; hi: number }) => (Number.isNaN(w.p) ? "–" : `${pct(w.p)} [${pct(w.lo)}–${pct(w.hi)}]`);
