import { clamp, lerp } from "./ease.js";
import { mixColor } from "./color.js";
import type { Box, Entry, ObjDef, Props } from "./types.js";

export interface PresetCtx {
  /** Object state just before this animation is applied. */
  s: Props;
  /** Raw progress 0..1 (0 before start, 1 after end). */
  p: number;
  /** Eased progress. */
  e: number;
  params: Record<string, any>;
  box: Box;
  /** Duration of this animation, seconds. */
  dur: number;
}

export interface PrepareCtx {
  entry: Entry;
  target: string;
  def: ObjDef;
  box: Box;
  /** Resolve a props patch (tokens, `at`) into concrete props for `target`. */
  patch: (p: any) => Partial<Props>;
  /** Center of another object, or of a placement for `target`'s size. */
  center: (ref: any) => [number, number];
  /** Box of another object, a region, or a placement (at `target`'s size). */
  boxOf: (ref: any) => Box;
  /** Resolve a color token to hex. */
  color: (c: string) => string;
}

export interface Preset {
  kind: "enter" | "exit" | "change" | "loop";
  dur: number | "fast" | "base" | "slow" | "rest";
  ease: string;
  doc: string;
  prepare?: (c: PrepareCtx) => { params?: Record<string, any>; dur?: number };
  fn: (c: PresetCtx) => Partial<Props>;
}

function tween(s: Props, to: Partial<Props>, e: number): Partial<Props> {
  const out: any = {};
  for (const [k, v] of Object.entries(to)) {
    const a = (s as any)[k];
    out[k] = typeof v === "number" ? lerp(a, v, e) : mixColor(a, v as string, e);
  }
  return out;
}

/**
 * Anticipation: a small pull the other way before the move (the first 25% of its time),
 * `amt` as a fraction of the move. Zero amt leaves the eased progress untouched.
 */
export function anticipate(e: number, p: number, amt: number | undefined): number {
  if (!amt || p <= 0 || p >= 0.25) return e;
  return e - amt * Math.sin((Math.PI * p) / 0.25);
}

/** Envelope for ambient loops: 0 at both ends, 1 after `ramp` seconds, so they never jump at a seam. */
const envelope = (u: number, dur: number, ramp = 0.6) => clamp(Math.min(u, dur - u) / ramp);

/** Unit vector for a `side` (where a thing comes from or goes to). */
export function sideVec(side: string | undefined, fallback: string): [number, number] {
  switch (side ?? fallback) {
    case "left": return [-1, 0];
    case "right": return [1, 0];
    case "up": return [0, -1];
    default: return [0, 1];
  }
}

const eo = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const ei = (x: number) => Math.pow(clamp(x), 3);

/** Word-by-word (or line-by-line) entrance or exit for text objects. */
function wordsPreset(mode: "in" | "out", unit: "word" | "line"): Preset {
  const pace0 = unit === "word" ? (mode === "in" ? 0.11 : 0.06) : mode === "in" ? 0.28 : 0.15;
  const each0 = mode === "in" ? 0.5 : 0.3;
  const what = unit === "word" ? "word by word" : "line by line";
  return {
    kind: mode === "in" ? "enter" : "exit",
    dur: "base",
    ease: "linear",
    doc: mode === "in"
      ? `text enters ${what} from one \`side\` (default right), drifting \`distance\` px (default 28), \`pace\` s apart (default ${pace0}); duration fits the text`
      : `text leaves ${what} toward \`side\` (default left), quicker than it came; \`pace\` default ${pace0}`,
    prepare: ({ def, entry }) => {
      if (def.type !== "text") throw new Error(`${entry.preset} only works on text objects`);
      const text = def.text ?? "";
      const n = Math.max(1, unit === "word" ? text.split(/\s+/).filter(Boolean).length : text.split("\n").length);
      const pace = entry.pace ?? pace0;
      const each = entry.dur !== undefined && typeof entry.dur === "number" ? Math.max(0.15, entry.dur - (n - 1) * pace) : each0;
      return { params: { n, pace, each }, dur: entry.dur === undefined ? (n - 1) * pace + each : undefined };
    },
    fn: ({ s, p, dur, params }) => {
      if (mode === "out" && p <= 0) return {};
      const u = p * dur, v: number[] = [];
      for (let i = 0; i < params.n; i++) {
        const q = (u - i * params.pace) / params.each;
        v.push(mode === "in" ? eo(q) : 1 - ei(q));
      }
      const [vx, vy] = sideVec(params.side, mode === "in" ? "right" : "left");
      const d = params.distance ?? (mode === "in" ? 28 : 22);
      return {
        opacity: mode === "in" ? (p > 0 ? 1 : 0) : p >= 1 ? 0 : s.opacity,
        words: { v, dx: vx * d, dy: vy * d, lines: unit === "line" },
      } as any;
    },
  };
}

const toPreset = (doc: string, ease = "inOut", dur: Preset["dur"] = "base"): Preset => ({
  kind: "change",
  dur,
  ease,
  doc,
  prepare: ({ entry, patch }) => {
    if (entry.to === undefined) throw new Error(`needs "to" (props like { "fill": "bad" } or a placement)`);
    const to = typeof entry.to === "string" || isPlacement(entry.to) ? { at: entry.to } : entry.to;
    return { params: { to: patch(to) } };
  },
  fn: ({ s, e, p, params }) => tween(s, params.to, anticipate(e, p, params.anticipate)),
});

function isPlacement(v: any) {
  return v && typeof v === "object" && ["region", "in", "below", "above", "leftOf", "rightOf", "x"].some((k) => k in v);
}

export const PRESETS: Record<string, Preset> = {
  "fade-in": { kind: "enter", dur: "base", ease: "out", doc: "opacity 0 → 1", fn: ({ e }) => ({ opacity: e }) },
  "fade-out": { kind: "exit", dur: "base", ease: "in", doc: "opacity → 0", fn: ({ s, e }) => ({ opacity: s.opacity * (1 - e) }) },
  "rise-in": {
    kind: "enter", dur: "base", ease: "out", doc: "fade in while rising `distance` px (default 40)",
    fn: ({ s, e, p, params }) => ({ opacity: clamp(p * 2), dy: s.dy + (1 - e) * (params.distance ?? 40) }),
  },
  "sink-out": {
    kind: "exit", dur: "fast", ease: "in", doc: "fade out while sinking `distance` px (default 30)",
    fn: ({ s, e, params }) => ({ opacity: s.opacity * (1 - e), dy: s.dy + e * (params.distance ?? 30) }),
  },
  pop: {
    kind: "enter", dur: "base", ease: "back",
    doc: "lands with overshoot: scale 0.4 → 1 (`overshoot`, default 1.7; 1.4–1.9 for shapes, 1.5 for pills), opacity done in 0.2 s, optional `spin` (degrees it un-rotates from)",
    // Absolute, like every entrance: it brings in objects that a key hid (opacity 0 or scale 0).
    fn: ({ s, e, p, dur, params }) => ({
      scale: Math.max(0, lerp(0.4, 1, e)),
      opacity: eo((p * dur) / 0.2),
      rotate: s.rotate + (params.spin ?? 0) * (1 - e),
    }),
  },
  "pop-out": {
    kind: "exit", dur: "fast", ease: "in", doc: "scale → 0",
    fn: ({ s, e }) => ({ scale: s.scale * (1 - e), opacity: e >= 1 ? 0 : s.opacity }),
  },
  "scale-in": {
    kind: "enter", dur: "base", ease: "out", doc: "scale 0.85 → 1 with fade",
    fn: ({ e }) => ({ scale: lerp(0.85, 1, e), opacity: e }),
  },
  "draw-on": {
    kind: "enter", dur: "slow", ease: "inOut", doc: "stroke draws on, then fill fades in (rect, circle, line, arrow, path)",
    fn: ({ s, e, p }) => ({ opacity: p > 0 ? 1 : 0, draw: e, fillOpacity: s.fillOpacity * clamp((p - 0.55) / 0.45) }),
  },
  "draw-off": {
    kind: "exit", dur: "base", ease: "inOut", doc: "reverse of draw-on",
    fn: ({ s, e }) => ({ draw: s.draw * (1 - e), fillOpacity: s.fillOpacity * (1 - clamp(e * 2)) , opacity: e >= 1 ? 0 : s.opacity }),
  },
  "type-on": {
    kind: "enter", dur: "base", ease: "linear", doc: "text types on; default duration scales with length",
    prepare: ({ def, entry }) => (entry.dur === undefined ? { dur: clamp((def.text ?? "").length * 0.035, 0.4, 2.5) } : {}),
    fn: ({ p }) => ({ opacity: p > 0 ? 1 : 0, reveal: p }),
  },
  "wipe-in": { kind: "enter", dur: "base", ease: "inOut", doc: "revealed left → right", fn: ({ e, p }) => ({ opacity: p > 0 ? 1 : 0, clip: e }) },
  "fly-from": {
    kind: "enter", dur: "slow", ease: "inOut", doc: "fly into place from `from` (an object id or placement)",
    prepare: ({ entry, center }) => {
      if (entry.from === undefined) throw new Error(`needs "from" (object id or placement)`);
      return { params: { from: center(entry.from) } };
    },
    fn: ({ s, e, p, params, box }) => {
      const a = anticipate(e, p, params.anticipate);
      return {
        opacity: clamp(p * 6),
        dx: s.dx + (params.from[0] - box.x - s.dx) * (1 - a),
        dy: s.dy + (params.from[1] - box.y - s.dy) * (1 - a),
        scale: s.scale * lerp(0.7, 1, e),
      };
    },
  },
  to: toPreset("tween to props (`to: { fill, scale, opacity, ... }`) or to a placement (`to: \"right-half\"`)"),
  move: toPreset("alias of `to`"),
  "count-up": toPreset("tween `value` for text containing {value}: `to: { value: 40 }`", "out", "slow"),
  pulse: {
    kind: "loop", dur: "base", ease: "linear", doc: "scale bump by `amount` (default 0.08) and back",
    fn: ({ s, p, params }) => ({ scale: s.scale * (1 + (params.amount ?? 0.08) * Math.sin(Math.PI * p)) }),
  },
  shake: {
    kind: "loop", dur: "base", ease: "linear", doc: "horizontal shake, `amount` px (default 16), `cycles` (default 4)",
    fn: ({ s, p, params }) => ({ dx: s.dx + (params.amount ?? 16) * Math.sin(p * Math.PI * 2 * (params.cycles ?? 4)) * (1 - p) }),
  },
  highlight: {
    kind: "loop", dur: "slow", ease: "linear", doc: "stroke flashes to `color` (default accent) and back",
    prepare: ({ entry, color }) => ({ params: { color: color(entry.color ?? "accent") } }),
    fn: ({ s, p, params }) => {
      // Outside its own window it changes nothing (before, it set the stroke at the section's t=0: a seam error).
      if (p <= 0 || p >= 1) return {};
      const b = Math.sin(Math.PI * p);
      return { stroke: mixColor(s.stroke === "none" ? params.color : s.stroke, params.color, b), strokeWidth: s.strokeWidth + 4 * b };
    },
  },
  play: {
    kind: "change", dur: "slow", ease: "linear", doc: "play a video clip: `start` (clip second, default: current playhead), `rate` (default 1); give `dur`",
    prepare: ({ entry, def }) => {
      if (def.type !== "video") throw new Error(`play only works on video objects`);
      if (entry.dur === undefined) throw new Error(`play needs "dur" (seconds of timeline to play)`);
      return { params: { start: entry.start, rate: entry.rate ?? 1 } };
    },
    // Before it starts, a play only sets the poster frame if nothing earlier has moved the playhead.
    fn: ({ s, p, params, dur }) => (p <= 0 && s.time !== 0 ? {} : { time: (params.start ?? s.time) + p * dur * params.rate }),
  },
  focus: {
    kind: "change", dur: 0.9, ease: "arrive",
    doc: "camera: zoom onto `on` (an object or placement) so it fills ~84% of the frame, at most 2.4× (`zoom` overrides); `on: \"full\"` goes back to the whole frame",
    prepare: ({ entry, target, boxOf, box }) => {
      if (target !== "camera") throw new Error(`focus moves the camera: use "target": "camera"`);
      if (entry.on === undefined) throw new Error(`needs "on" (the object or placement to zoom onto; "full" for the whole frame)`);
      const b = boxOf(entry.on), W = box.w, H = box.h;
      const full = entry.on === "full";
      const fit = Math.min((W * 0.84) / Math.max(1, b.w), (H * 0.84) / Math.max(1, b.h));
      const z = entry.zoom ?? (full ? 1 : clamp(fit, 1, 2.4));
      // The camera scales about the frame centre, then shifts: a point P lands at (P - C) * z + C + d.
      return { params: { z, on: typeof entry.on === "string" ? entry.on : "a placement", dx: full ? 0 : -(b.x - W / 2) * z, dy: full ? 0 : -(b.y - H / 2) * z } };
    },
    // Zoom in log space, so a 1× → 2.4× push feels even all the way.
    fn: ({ s, e, params }) => ({ scale: s.scale * Math.pow(params.z / s.scale, e), dx: lerp(s.dx, params.dx, e), dy: lerp(s.dy, params.dy, e) }),
  },
  drift: {
    kind: "loop", dur: "slow", ease: "sine", doc: "slow push-in (use on `camera` as a through track), `amount` default 0.04",
    fn: ({ s, e, params }) => ({ scale: s.scale * (1 + (params.amount ?? 0.04) * e) }),
  },
  "words-in": wordsPreset("in", "word"),
  "words-out": wordsPreset("out", "word"),
  "lines-in": wordsPreset("in", "line"),
  "lines-out": wordsPreset("out", "line"),
  breathe: {
    kind: "loop", dur: "rest", ease: "linear",
    doc: "held shapes stay alive: scale ±`amount` (default 0.012) on a `period` s sine (default 3); eases in and out over 0.6 s so it never jumps at a seam; each target in a list gets its own phase",
    fn: ({ s, p, dur, params }) => {
      const u = p * dur, ph = (params.index ?? 0) * 0.7;
      return { scale: s.scale * (1 + (params.amount ?? 0.012) * Math.sin((2 * Math.PI * (u + ph)) / (params.period ?? 3)) * envelope(u, dur)) };
    },
  },
  sway: {
    kind: "loop", dur: "rest", ease: "linear",
    doc: "a slow rotation wobble while held: ±`amount` degrees (default 1.2) on a `period` s sine (default 3.4); eases in and out like breathe",
    fn: ({ s, p, dur, params }) => {
      const u = p * dur, ph = (params.index ?? 0) * 0.9;
      return { rotate: s.rotate + (params.amount ?? 1.2) * Math.sin((2 * Math.PI * (u + ph)) / (params.period ?? 3.4)) * envelope(u, dur) };
    },
  },
  creep: {
    kind: "loop", dur: "rest", ease: "linear",
    doc: "a hold that creeps `amount` px/s (default 2) toward `side` (default up), never reversing. It doesn't return: use it on local objects, titles and the camera, not on shared objects that must end on a key",
    fn: ({ s, p, dur, params }) => {
      const [vx, vy] = sideVec(params.side, "up"), d = (params.amount ?? 2) * p * dur;
      return { dx: s.dx + vx * d, dy: s.dy + vy * d };
    },
  },
  wobble: {
    kind: "loop", dur: "slow", ease: "linear",
    doc: "attention wobble after something lands: rotation ±`amount` degrees (default 9) that decays over the duration, `cycles` (default 3)",
    fn: ({ s, p, params }) => ({ rotate: s.rotate + (params.amount ?? 9) * Math.sin(p * Math.PI * 2 * (params.cycles ?? 3)) * (1 - p) }),
  },
  clear: {
    kind: "exit", dur: "fast", ease: "in",
    doc: "the section clears itself: every target (default: all its local objects) fades and drifts `distance` px (default 40) toward `side` (default left), staggered in declaration order (0.06 s apart, closer when there are many, so the set fits in ~0.25 s). Put it at \"end-0.6\"",
    fn: ({ s, e, params }) => {
      const [vx, vy] = sideVec(params.side, "left"), d = (params.distance ?? 40) * e;
      return { opacity: s.opacity * (1 - e), dx: s.dx + vx * d, dy: s.dy + vy * d };
    },
  },
};

/** Ambient motion: keeps a hold alive but is not a beat (dead-air counts it; no-beat doesn't). Silent in foley. */
export const AMBIENT = new Set(["breathe", "sway", "creep", "drift"]);
