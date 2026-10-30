import type { Box, ObjDef, Placement, PointRef } from "./types.js";
import { size, type Theme } from "./theme.js";

export function regions(W: number, H: number, safe: number): Record<string, Box> {
  const L = safe, T = safe, SW = W - 2 * safe, SH = H - 2 * safe;
  const r = (x: number, y: number, w: number, h: number): Box => ({ x: x + w / 2, y: y + h / 2, w, h });
  const band = SH * 0.28;
  return {
    full: r(0, 0, W, H),
    center: r(L, T, SW, SH),
    "left-half": r(L, T, SW / 2, SH),
    "right-half": r(L + SW / 2, T, SW / 2, SH),
    "top-half": r(L, T, SW, SH / 2),
    "bottom-half": r(L, T + SH / 2, SW, SH / 2),
    "left-third": r(L, T, SW / 3, SH),
    "center-third": r(L + SW / 3, T, SW / 3, SH),
    "right-third": r(L + (2 * SW) / 3, T, SW / 3, SH),
    "left-two-thirds": r(L, T, (2 * SW) / 3, SH),
    "right-two-thirds": r(L + SW / 3, T, (2 * SW) / 3, SH),
    top: r(L, T, SW, band),
    middle: r(L, T + band, SW, SH - 2 * band),
    bottom: r(L, T + SH - band, SW, band),
    "top-left": r(L, T, SW / 2, SH / 2),
    "top-right": r(L + SW / 2, T, SW / 2, SH / 2),
    "bottom-left": r(L, T + SH / 2, SW / 2, SH / 2),
    "bottom-right": r(L + SW / 2, T + SH / 2, SW / 2, SH / 2),
  };
}

export const left = (b: Box) => b.x - b.w / 2;
export const right = (b: Box) => b.x + b.w / 2;
export const top = (b: Box) => b.y - b.h / 2;
export const bottom = (b: Box) => b.y + b.h / 2;

const SIDES = new Set(["center", "top", "bottom", "left", "right"]);

/**
 * "obj" → center; "obj.top" → side midpoint; "obj.top:0.8" → 80% along that side (left→right, top→bottom).
 * Ids may contain dots (section prefixes), so only a trailing side name splits.
 */
export function splitPointRef(ref: string): { id: string; side: string; frac: number } {
  const m = /^(.*)\.(center|top|bottom|left|right)(?::([\d.]+))?$/.exec(ref);
  if (m && m[1]) return { id: m[1], side: m[2], frac: m[3] !== undefined ? Number(m[3]) : 0.5 };
  return { id: ref, side: "center", frac: 0.5 };
}

/** The point a side/fraction refers to on a box. */
export function sidePoint(b: Box, side: string, frac: number): [number, number] {
  const l = b.x - b.w / 2, t = b.y - b.h / 2;
  switch (side) {
    case "top": return [l + b.w * frac, t];
    case "bottom": return [l + b.w * frac, t + b.h];
    case "left": return [l, t + b.h * frac];
    case "right": return [l + b.w, t + b.h * frac];
    default: return [b.x, b.y];
  }
}

/** Quadratic control point for a bent line: the curve's midpoint sits `bend` px left of the direction of travel. */
export function curveControl(a: [number, number], b: [number, number], bend: number): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len;
  return [(a[0] + b[0]) / 2 + nx * bend * 2, (a[1] + b[1]) / 2 + ny * bend * 2];
}
export function curveApex(a: [number, number], b: [number, number], bend: number): [number, number] {
  const c = curveControl(a, b, bend);
  return [0.25 * a[0] + 0.5 * c[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * c[1] + 0.25 * b[1]];
}
/** Points along a (possibly bent) line, for hit-testing. */
export function linePoints(a: [number, number], b: [number, number], bend = 0, n = 16): [number, number][] {
  if (!bend) return [a, b];
  const c = curveControl(a, b, bend);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as [number, number];
  });
}

export function textMetrics(def: ObjDef, theme: Theme) {
  const st = theme.text[def.style ?? "body"];
  if (!st) throw new Error(`unknown text style "${def.style}" (have: ${Object.keys(theme.text).join(", ")})`);
  const fs = def.size ?? st.size;
  const weight = def.weight ?? st.weight;
  const mono = st.font === "mono";
  const family = mono ? theme.fonts.mono : theme.fonts.sans;
  const lines = (def.text ?? "").replace(/\{value\}/g, "0000").split("\n");
  const factor = (mono ? 0.6 : 0.54) * (weight >= 650 ? 1.05 : 1);
  const w = Math.max(...lines.map((l) => l.length)) * fs * factor;
  const h = lines.length * fs * 1.25;
  return { w, h, font: { family, size: fs, weight }, lines };
}

function alignIn(box: Box, w: number, h: number, align = "center"): [number, number] {
  let x = box.x, y = box.y;
  if (align.includes("left")) x = left(box) + w / 2;
  if (align.includes("right")) x = right(box) - w / 2;
  if (align.includes("top")) y = top(box) + h / 2;
  if (align.includes("bottom")) y = bottom(box) - h / 2;
  return [x, y];
}

export interface LayoutResult {
  layout: Record<string, Box>;
  points: Record<string, [[number, number], [number, number]]>;
  errors: string[];
  /** Center for an object of size w×h at a placement, against the resolved layout. */
  place: (at: Placement, w: number, h: number, owner: string) => [number, number];
}

export function computeLayout(
  objs: Record<string, ObjDef>,
  parentOf: Record<string, string>,
  theme: Theme,
  W: number,
  H: number,
): LayoutResult {
  const R = regions(W, H, theme.safe);
  const layout: Record<string, Box> = {};
  const points: LayoutResult["points"] = {};
  const errors: string[] = [];
  const visiting = new Set<string>();

  const sz = (v: number | string | undefined, fb: number) => size(theme, "space", v, fb);

  function natural(id: string): { w: number; h: number } {
    const d = objs[id];
    switch (d.type) {
      case "rect": {
        // A rect with a label sizes itself to the text unless w/h are given (frames keep explicit sizes).
        if (d.text && !d.frame && (d.w === undefined || d.h === undefined)) {
          const m = textMetrics({ ...d, style: d.style ?? "label" }, theme);
          return { w: sz(d.w, Math.ceil(m.w + 2 * theme.space.md)), h: sz(d.h, Math.ceil(m.h + 2 * theme.space.sm)) };
        }
        return { w: sz(d.w, 200), h: sz(d.h, 120) };
      }
      case "circle": { const r = sz(d.r, 40); return { w: 2 * r, h: 2 * r }; }
      case "spotlight": {
        // Framing another object: its box plus `pad` on every side.
        if (d.on && objs[d.on] && d.w === undefined && d.h === undefined) {
          const b = resolve(d.on), pad = sz(d.pad, 24);
          return { w: b.w + 2 * pad, h: b.h + 2 * pad };
        }
        return { w: sz(d.w, 400), h: sz(d.h, 240) };
      }
      case "chip": {
        // Chip: padding 12 × 22 around the words.
        const m = textMetrics({ ...d, style: d.style ?? "label" }, theme), pad = sz(d.pad, 22);
        return { w: Math.ceil(m.w + 2 * pad), h: Math.ceil(m.h + 24) };
      }
      case "text": return textMetrics(d, theme);
      case "path": case "svg": return { w: sz(d.w, 100), h: sz(d.h, 100) };
      case "video": { const w = sz(d.w, d.h !== undefined ? (sz(d.h, 720) * 16) / 9 : 1280); return { w, h: sz(d.h, (w * 9) / 16) }; }
      case "group": {
        if (!d.layout) { const b = resolve(id); return { w: b.w, h: b.h }; }
        const kids = (d.children ?? []).map(natural);
        const gap = sz(d.layout.gap, theme.space.md);
        const along = d.layout.dir === "row";
        const main = kids.reduce((a, k) => a + (along ? k.w : k.h), 0) + gap * Math.max(0, kids.length - 1);
        const cross = Math.max(0, ...kids.map((k) => (along ? k.h : k.w)));
        return along ? { w: main, h: cross } : { w: cross, h: main };
      }
      default: return { w: 0, h: 0 };
    }
  }

  function point(ref: PointRef, owner: string): [number, number] {
    if (Array.isArray(ref)) return ref;
    const { id, side, frac } = splitPointRef(ref);
    if (!objs[id]) { errors.push(`${owner}: point "${ref}" refers to unknown object "${id}" (sides: center|top|bottom|left|right, optional :fraction)`); return [W / 2, H / 2]; }
    return sidePoint(resolve(id), side, frac);
  }

  function place(at: Placement | undefined, w: number, h: number, owner: string): [number, number] {
    if (at === undefined) return [R.center.x, R.center.y];
    const p = typeof at === "string" ? { region: at } : at;
    let x: number, y: number;
    if (p.region !== undefined) {
      const box = R[p.region];
      if (!box) { errors.push(`${owner}: unknown region "${p.region}" (have: ${Object.keys(R).join(", ")})`); return [W / 2, H / 2]; }
      [x, y] = alignIn(box, w, h, p.align);
    } else if (p.in !== undefined) {
      if (!objs[p.in]) { errors.push(`${owner}: "in" refers to unknown object "${p.in}"`); return [W / 2, H / 2]; }
      const b = resolve(p.in), pad = sz(p.pad, theme.space.sm);
      [x, y] = alignIn({ x: b.x, y: b.y, w: b.w - 2 * pad, h: b.h - 2 * pad }, w, h, p.align);
    } else if (p.x !== undefined && p.y !== undefined) {
      [x, y] = [p.x, p.y];
    } else {
      const rel = (["below", "above", "leftOf", "rightOf"] as const).find((k) => p[k] !== undefined)!;
      const refId = p[rel]!;
      if (!objs[refId]) { errors.push(`${owner}: "${rel}" refers to unknown object "${refId}"`); return [W / 2, H / 2]; }
      const b = resolve(refId), gap = sz(p.gap, theme.space.md), a = p.align ?? "center";
      if (rel === "below" || rel === "above") {
        y = rel === "below" ? bottom(b) + gap + h / 2 : top(b) - gap - h / 2;
        x = a.includes("left") ? left(b) + w / 2 : a.includes("right") ? right(b) - w / 2 : b.x;
      } else {
        x = rel === "rightOf" ? right(b) + gap + w / 2 : left(b) - gap - w / 2;
        y = a.includes("top") ? top(b) + h / 2 : a.includes("bottom") ? bottom(b) - h / 2 : b.y;
      }
    }
    return [x + (p.dx ?? 0), y + (p.dy ?? 0)];
  }

  /** Lay out a layout group's children in its box, and recurse into children that are layout groups themselves. */
  function stack(id: string, box: Box) {
    const d = objs[id];
    if (!d.layout) return;
    const along = d.layout.dir === "row", gap = sz(d.layout.gap, theme.space.md), al = d.layout.align ?? "center";
    let cursor = along ? left(box) : top(box);
    for (const kid of d.children ?? []) {
      const k = natural(kid);
      const crossC = along ? box.y : box.x, crossS = along ? box.h : box.w, kc = along ? k.h : k.w;
      const cross = al === "start" ? crossC - crossS / 2 + kc / 2 : al === "end" ? crossC + crossS / 2 - kc / 2 : crossC;
      layout[kid] = along
        ? { x: cursor + k.w / 2, y: cross, w: k.w, h: k.h }
        : { x: cross, y: cursor + k.h / 2, w: k.w, h: k.h };
      cursor += (along ? k.w : k.h) + gap;
      if (objs[kid]?.type === "group" && objs[kid].layout) stack(kid, layout[kid]);
    }
  }

  function resolve(id: string): Box {
    if (layout[id]) return layout[id];
    if (visiting.has(id)) { errors.push(`layout cycle involving "${id}"`); return { x: W / 2, y: H / 2, w: 0, h: 0 }; }
    visiting.add(id);
    const d = objs[id];
    const parent = parentOf[id];
    let box: Box;

    if (parent && objs[parent].layout) {
      resolve(parent); // the stack assigns this child's box
      box = layout[id] ?? { x: W / 2, y: H / 2, w: 0, h: 0 };
    } else if (d.type === "line" || d.type === "arrow") {
      if (!d.from || !d.to) errors.push(`${id}: ${d.type} needs "from" and "to"`);
      let a = point(d.from ?? [0, 0], id), b = point(d.to ?? [0, 0], id);
      if (d.type === "arrow") {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, inset = Math.min(12, len / 4);
        const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
        a = [a[0] + ux * inset, a[1] + uy * inset];
        b = [b[0] - ux * inset, b[1] - uy * inset];
      }
      points[id] = [a, b];
      const xs = [a[0], b[0]], ys = [a[1], b[1]];
      if (d.bend) { const [ax, ay] = curveApex(a, b, d.bend); xs.push(ax); ys.push(ay); }
      const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), btm = Math.max(...ys);
      box = { x: (l + r) / 2, y: (t + btm) / 2, w: r - l, h: btm - t };
    } else if (d.type === "group" && !d.layout) {
      const kids = (d.children ?? []).map(resolve);
      if (!kids.length) box = { x: W / 2, y: H / 2, w: 0, h: 0 };
      else {
        const l = Math.min(...kids.map(left)), r = Math.max(...kids.map(right));
        const t = Math.min(...kids.map(top)), btm = Math.max(...kids.map(bottom));
        box = { x: (l + r) / 2, y: (t + btm) / 2, w: r - l, h: btm - t };
      }
    } else {
      const n = natural(id);
      if (d.type === "spotlight" && d.on && !objs[d.on]) errors.push(`${id}: "on" refers to unknown object "${d.on}"`);
      const at = d.at ?? (d.type === "spotlight" && d.on && objs[d.on] ? { in: d.on, pad: 0 } : undefined);
      const [x, y] = place(at, n.w, n.h, id);
      box = { x, y, w: n.w, h: n.h };
      if (d.type === "group" && d.layout) stack(id, box);
      // A chip's leader runs from the edge of its pill to the point it names.
      if (d.type === "chip" && d.to !== undefined) {
        const b = point(d.to, id), dx = b[0] - x, dy = b[1] - y;
        const k = Math.min(dx ? n.w / 2 / Math.abs(dx) : Infinity, dy ? n.h / 2 / Math.abs(dy) : Infinity, 1);
        points[id] = [[x + dx * k, y + dy * k], b];
      }
    }
    visiting.delete(id);
    layout[id] = box;
    return box;
  }

  for (const id of Object.keys(objs)) resolve(id);
  return { layout, points, errors, place };
}
