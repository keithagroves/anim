import { clamp, ease } from "./ease.js";
import { PRESETS } from "./presets.js";
import { CAMERA } from "./compile.js";
import type { CAnim, CScene, Frame, Props } from "./types.js";

export const CAMERA_BASE: Props = {
  opacity: 1, scale: 1, rotate: 0, dx: 0, dy: 0, w: 0, h: 0, fill: "none", stroke: "none",
  strokeWidth: 0, fillOpacity: 1, draw: 1, reveal: 1, clip: 1, value: 0, time: 0,
};

export function activeSection(c: CScene, t: number): number {
  for (let k = 0; k < c.spans.length; k++) if (t < c.spans[k].end) return k;
  return c.spans.length - 1;
}

/**
 * The scene's full state at time t. Pure: same input, same output.
 * State = base props → cumulative keys at the active section's start → that section's
 * animations → scene-wide through tracks. Every animation is always applied with its
 * progress clamped to 0..1, so entrances hide their objects before they start.
 */
export function evaluate(c: CScene, t: number, opts: { section?: number } = {}): Frame {
  t = clamp(t, 0, c.duration);
  const k = opts.section ?? activeSection(c, t);
  const objects: Frame["objects"] = {};
  for (const [id, o] of Object.entries(c.objects)) {
    if (o.owner !== "scene" && o.owner !== k) objects[id] = { ...o.base, opacity: 0, hidden: true };
    else objects[id] = { ...o.base, ...(o.owner === "scene" ? c.keysAt[k]?.[id] : undefined) };
  }
  const camera = { ...CAMERA_BASE };
  const canvas = { x: c.size[0] / 2, y: c.size[1] / 2, w: c.size[0], h: c.size[1] };

  const apply = (a: CAnim) => {
    const s = a.target === CAMERA ? camera : objects[a.target];
    if (!s || (s as any).hidden) return;
    const preset = PRESETS[a.preset];
    const p = a.dur > 0 ? clamp((t - a.start) / a.dur) : t >= a.start ? 1 : 0;
    const e = ease(a.ease, preset.ease, a.params)(p);
    Object.assign(s, preset.fn({ s, p, e, params: a.params, box: c.layout[a.target] ?? canvas, dur: a.dur }));
  };
  for (const a of c.anims[k] ?? []) apply(a);
  for (const a of c.through) apply(a);
  return { t, section: k, objects, camera };
}
