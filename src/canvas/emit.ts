// Second renderer: a compiled scene → timed tldraw commands for the live canvas.
// Layout and timing come from the same solver as the video renderer, so nothing here invents coordinates.
import { splitPointRef } from "../engine/layout.js";
import { PRESETS } from "../engine/presets.js";
import type { CScene, CObj, PointRef } from "../engine/types.js";

export interface CanvasCmd { op: string; at?: number; ms?: number; name?: string; [k: string]: unknown }

/** Map a theme colour to tldraw's fixed palette (black, grey, red, orange, yellow, green, blue, violet + light variants). */
function tlColor(hex: string | undefined, fallback = "black"): string {
  const m = hex && /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return fallback;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  // Dark surfaces and near-white text (dark video theme) both read as black on a light canvas.
  if (l < 0.18 || l > 0.9) return "black";
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (sat < 0.25) return "grey";
  // Match on hue (perceptual family), not RGB distance, which confuses violet with blue.
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return l > 0.65 ? "light-red" : "red";
  if (h < 40) return "orange";
  if (h < 65) return "yellow";
  if (h < 170) return l > 0.6 ? "light-green" : "green";
  if (h < 205) return "light-blue";
  if (h < 245) return "blue";
  if (h < 300) return l > 0.75 ? "light-violet" : "violet";
  return "light-red";
}
const tlSize = (px: number) => (px <= 24 ? "s" : px <= 38 ? "m" : px <= 64 ? "l" : "xl");

interface Timing { at: number; ms: number; exitAt?: number; exitMs?: number; moves: { at: number; ms: number; dx: number; dy: number }[] }

/** When does an object (or one of its ancestors) enter and exit, according to the timeline? */
function timing(c: CScene, o: CObj): Timing {
  const chain: string[] = [];
  for (let id: string | undefined = o.id; id; id = c.objects[id]?.parent) chain.push(id);
  const anims = [...c.anims.flat(), ...c.through].filter((a) => chain.includes(a.target)).sort((a, b) => a.start - b.start);
  const enter = anims.find((a) => PRESETS[a.preset]?.kind === "enter");
  let at = 0, ms = 250;
  if (enter) { at = enter.start; ms = enter.dur * 1000; }
  else {
    // No entrance: visible from the first section whose key state shows it (or from the start).
    const k = c.keysAt.findIndex((keys) => chain.every((id) => (keys[id]?.opacity ?? c.objects[id].base.opacity) > 0.01));
    at = k >= 0 ? c.spans[k].start : 0;
    if (typeof o.owner === "number") at = Math.max(at, c.spans[o.owner].start);
  }
  // Exits: exit presets, or a `to` that fades the object (or an ancestor) to 0.
  const fadesOut = (a: (typeof anims)[number]) => PRESETS[a.preset]?.kind === "exit" || (a.params.to && a.params.to.opacity === 0);
  const exit = anims.find((a) => fadesOut(a) && a.start >= at);
  // Moves: `to` with dx/dy on the object or an ancestor (tldraw has no groups, so children move with them).
  const offsets = new Map<string, { dx: number; dy: number }>();
  const moves: Timing["moves"] = [];
  for (const a of anims) {
    const to = a.params.to;
    if (!to || (to.dx === undefined && to.dy === undefined) || (exit && a.start >= exit.start)) continue;
    const prev = offsets.get(a.target) ?? { dx: 0, dy: 0 };
    offsets.set(a.target, { dx: to.dx ?? prev.dx, dy: to.dy ?? prev.dy });
    let dx = 0, dy = 0;
    for (const v of offsets.values()) { dx += v.dx; dy += v.dy; }
    moves.push({ at: a.start, ms: a.dur * 1000, dx, dy });
  }
  return { at, ms, exitAt: exit ? exit.start : undefined, exitMs: exit ? exit.dur * 1000 : undefined, moves };
}

const ref = (r: PointRef | undefined, c: CScene): { end: string | [number, number]; anchor?: { x: number; y: number } } | undefined => {
  if (r === undefined) return undefined;
  if (Array.isArray(r)) return { end: r };
  const { id, side, frac } = splitPointRef(r);
  if (!c.objects[id]) return undefined;
  if (side === "center") return { end: id };
  const anchor = side === "top" ? { x: frac, y: 0 } : side === "bottom" ? { x: frac, y: 1 } : side === "left" ? { x: 0, y: frac } : { x: 1, y: frac };
  return { end: id, anchor };
};

export interface EmitOpts { speed?: number; instant?: boolean; audioUrl?: string; only?: Set<string> }

export function emitTldraw(c: CScene, o: EmitOpts = {}): { cmds: CanvasCmd[]; skipped: string[] } {
  const speed = o.speed ?? 1;
  const skipped: string[] = [];
  const shapes: CanvasCmd[] = [];
  const startOf = new Map<string, number>();

  for (const ob of Object.values(c.objects)) {
    const d = ob.def, b = c.layout[ob.id];
    if (d.type === "group") continue;
    if (o.only && !o.only.has(ob.id)) continue;
    const t = timing(c, ob);
    // A pre-rolled entrance (negative start, so the video's frame 0 shows it) is simply there at 0 on the board.
    const base = { name: ob.id, at: Math.max(0, t.at), ms: t.at < 0 ? Math.max(0, t.ms + t.at * 1000) : t.ms };
    const left = b.x - b.w / 2, top = b.y - b.h / 2;
    const stroke = ob.base.stroke !== "none" ? ob.base.stroke : ob.base.fill;
    let cmd: CanvasCmd | null = null;
    if (d.type === "rect" && d.frame) cmd = { op: "frame", ...base, x: left, y: top, w: b.w, h: b.h, label: d.text ?? "", color: tlColor(stroke) };
    else if (d.type === "rect" || d.type === "circle")
      cmd = { op: "geo", ...base, geo: d.type === "circle" ? "ellipse" : "rectangle", x: left, y: top, w: b.w, h: b.h, text: d.text ?? "", color: tlColor(stroke), fill: "semi", size: tlSize(ob.font?.size ?? 24) };
    else if (d.type === "text")
      cmd = { op: "text", ...base, x: left, y: top, text: (d.text ?? "").replace(/\{value\}/g, String(ob.base.value)), size: tlSize(ob.font?.size ?? 28), color: tlColor(ob.base.fill) };
    else if (d.type === "arrow" || d.type === "line") {
      const from = ref(d.from, c), to = ref(d.to, c);
      if (from === undefined || to === undefined) { skipped.push(ob.id); continue; }
      cmd = { op: "arrow", ...base, from: from.end, to: to.end, fromAnchor: from.anchor, toAnchor: to.anchor, text: d.text, bend: d.bend ? -d.bend : undefined /* tldraw bends the opposite way */, color: tlColor(ob.base.stroke), dash: d.dash ? "dashed" : "draw", size: "s" };
    } else { skipped.push(`${ob.id} (${d.type})`); continue; }
    startOf.set(ob.id, t.at);
    shapes.push(cmd);
    if (cmd.op !== "arrow") for (const m of t.moves) shapes.push({ op: "update", name: ob.id, at: m.at, ms: m.ms, x: left + m.dx, y: top + m.dy });
    if (t.exitAt !== undefined) shapes.push({ op: "remove", name: ob.id, at: t.exitAt, ms: t.exitMs });
  }

  // Arrows must start after the boxes they bind to exist.
  for (const s of shapes) {
    if (s.op !== "arrow") continue;
    for (const end of [s.from, s.to]) if (typeof end === "string" && startOf.has(end)) s.at = Math.max(s.at!, startOf.get(end)! + 0.05);
  }
  shapes.sort((a, b) => a.at! - b.at! || (a.op === "frame" ? -1 : 0) - (b.op === "frame" ? -1 : 0));

  for (const s of shapes) {
    if (o.instant) { s.at = 0; s.ms = 0; }
    else { s.at = Math.round((s.at! / speed) * 1000) / 1000; s.ms = Math.round(s.ms! / speed); }
  }
  const [W, H] = c.size;
  const head: CanvasCmd[] = o.only ? [] : [{ op: "clear", at: 0 }, { op: "bounds", at: 0, x: 0, y: 0, w: W, h: H, ms: 0 }];
  if (o.audioUrl && !o.instant && speed === 1 && !o.only) head.push({ op: "audio", at: 0, src: o.audioUrl });
  return { cmds: [...head, ...shapes], skipped };
}
