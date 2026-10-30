import { evaluate } from "./evaluate.js";
import { contrast, luminance, mixColor } from "./color.js";
import { AMBIENT, PRESETS } from "./presets.js";
import { BOUNCY } from "./ease.js";
import { CAMERA } from "./compile.js";
import type { Box, CScene, Frame, Props } from "./types.js";
import { linePoints, splitPointRef } from "./layout.js";
import { backdropTones } from "./backdrop.js";

export interface Issue { level: "error" | "warn"; rule: string; where: string; message: string; /** Section responsible, when known. */ section?: string }

// `time` (a video's playhead) is deliberately absent: a footage jump at a section boundary is a cut.
const COMPARE: (keyof Props)[] = ["opacity", "scale", "rotate", "dx", "dy", "w", "h", "fill", "stroke", "strokeWidth", "fillOpacity", "draw", "reveal", "clip", "value"];
const TOL: Partial<Record<keyof Props, number>> = { dx: 0.5, dy: 0.5, w: 0.5, h: 0.5, rotate: 0.5, strokeWidth: 0.25 };

/** Visual box of an object in a frame, including its own and its ancestors' offsets and scale. */
function visualBox(c: CScene, f: Frame, id: string) {
  const b = c.layout[id], s = f.objects[id];
  let x = b.x + s.dx, y = b.y + s.dy, w = s.w * s.scale, h = s.h * s.scale, op = s.opacity;
  for (let p = c.objects[id].parent; p; p = c.objects[p].parent) {
    const ps = f.objects[p], pb = c.layout[p];
    x = pb.x + ps.dx + (x - pb.x) * ps.scale;
    y = pb.y + ps.dy + (y - pb.y) * ps.scale;
    w *= ps.scale; h *= ps.scale; op *= ps.opacity;
  }
  return { x, y, w, h, op };
}

/** Liang–Barsky: does the segment (x1,y1)→(x2,y2) pass through the box? */
function segmentHitsBox(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  const l = b.x - b.w / 2, r = b.x + b.w / 2, t = b.y - b.h / 2, btm = b.y + b.h / 2;
  let u0 = 0, u1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  for (const [p, q] of [[-dx, x1 - l], [dx, r - x1], [-dy, y1 - t], [dy, btm - y1]] as const) {
    if (p === 0) { if (q < 0) return false; continue; }
    const u = q / p;
    if (p < 0) { if (u > u1) return false; if (u > u0) u0 = u; }
    else { if (u < u0) return false; if (u < u1) u1 = u; }
  }
  return u0 < u1;
}

/** Opacity after multiplying through every ancestor group. */
function effectiveOpacity(c: CScene, f: Frame, id: string): number {
  let op = f.objects[id].opacity;
  for (let p = c.objects[id].parent; p; p = c.objects[p].parent) op *= f.objects[p].opacity;
  return op;
}

/** Where the scene sits in the video: the first scene owns the thumbnail, the last one the end card. */
export interface LintCtx { index: number; count: number }

/** Minimum on-screen text size, px at 1080p (people watch on phones). */
export const MIN_TEXT_PX = 22;

/** Placeholder cards (sections not written yet) are scaffolding, not content: lint never sees them. */
export const isPlaceholder = (id: string) => id.includes(".~");

export function lint(cs: CScene, ctx: LintCtx = { index: 0, count: 1 }): Issue[] {
  const c: CScene = cs.spans.some((s) => s.placeholder)
    ? { ...cs, objects: Object.fromEntries(Object.entries(cs.objects).filter(([id]) => !isPlaceholder(id))), roots: cs.roots.filter((id) => !isPlaceholder(id)) }
    : cs;
  const isAncestor = (a: string, b: string) => { for (let p = c.objects[b]?.parent; p; p = c.objects[p].parent) if (p === a) return true; return false; };
  const issues: Issue[] = [];
  const add = (level: Issue["level"], rule: string, where: string, message: string, section?: string) => issues.push({ level, rule, where, message, section });
  const [W, H] = c.size;
  const last = c.spans.length - 1;
  const fmt = (v: number) => v.toFixed(2);

  c.spans.forEach((span, k) => {
    const sec = span.id;
    const anims = c.anims[k] ?? [];
    if (span.placeholder) { add("warn", "empty", sec, "section file not written yet: a placeholder card stands in for it", sec); return; }
    if (!anims.length) add("warn", "empty", sec, "section has no animations", sec);

    // Animations must stay inside their section (except the last section, which ends the scene).
    for (const a of anims) {
      // The first section may pre-roll (negative times), so frame 0 already shows its first line.
      if (k > 0 && a.start < span.start - 0.02) add("error", "span", sec, `${a.preset} → ${a.target} starts at ${fmt(a.start)}s, before the section starts (${fmt(span.start)}s)`, sec);
      if (a.start + a.dur > span.end + 0.02)
        add(k < last ? "error" : "warn", "boundary-spill", sec, `${a.preset} → ${a.target} runs until ${fmt(a.start + a.dur)}s, past the section end (${fmt(span.end)}s). Finish earlier, or make it a scene through track`, sec);
    }

    // Seam: the end of section k must equal the start of section k+1, exactly.
    if (k < last) {
      const A = evaluate(c, span.end, { section: k });
      const B = evaluate(c, span.end, { section: k + 1 });
      for (const [id, o] of Object.entries(c.objects)) {
        if (o.owner !== "scene") continue;
        const a = A.objects[id], b = B.objects[id];
        if (effectiveOpacity(c, A, id) < 0.01 && effectiveOpacity(c, B, id) < 0.01) continue;
        const diffs = COMPARE.filter((p) => {
          const va = a[p], vb = b[p];
          return typeof va === "number" ? Math.abs(va - (vb as number)) > (TOL[p] ?? 0.01) : va !== vb;
        });
        if (!diffs.length) continue;
        // Blame: if the end of section k differs from the declared key, k missed it; otherwise k+1 changed it at t=0.
        const key = { ...o.base, ...c.keysAt[k + 1]?.[id] };
        const same = (p: keyof Props, v: any) => typeof v === "number" ? Math.abs(v - (key[p] as number)) <= (TOL[p] ?? 0.01) : v === key[p];
        const missed = diffs.filter((p) => !same(p, a[p]));
        const changed = diffs.filter((p) => same(p, a[p]));
        const desc = (ps: (keyof Props)[]) => ps.map((p) => `${p} ${typeof a[p] === "number" ? fmt(a[p] as number) : a[p]} → ${typeof b[p] === "number" ? fmt(b[p] as number) : b[p]}`).join(", ");
        const next = c.spans[k + 1].id;
        if (missed.length)
          add("error", "seam", `${sec}→${next}`, `"${id}" jumps at ${fmt(span.end)}s (${desc(missed)}): ${sec} ends off its key "${sec}" for ${missed.join(", ")}`, sec);
        if (changed.length)
          add("error", "seam", `${sec}→${next}`, `"${id}" jumps at ${fmt(span.end)}s (${desc(changed)}): ${next} changes it at its t=0 (start entrances after the section start, or don't animate shared objects that are already on their key)`, next);
      }
      for (const [id, o] of Object.entries(c.objects)) {
        if (o.owner === k && o.def.type !== "group" && effectiveOpacity(c, A, id) > 0.01)
          add("error", "local-spill", sec, `local object "${id}" is still visible when the section ends; exit it before ${fmt(span.end)}s`, sec);
      }
    }

    // Dead air: long stretches inside the section where nothing animates. Ambient through tracks
    // (breathe, sway, creep, drift) keep a hold alive, so they count here.
    const ambientThrough = c.through.filter((a) => AMBIENT.has(a.preset) && a.target !== CAMERA);
    const iv = [...anims, ...ambientThrough]
      .filter((a) => a.start < span.end && a.start + a.dur > span.start)
      .map((a) => [Math.max(a.start, span.start), Math.min(a.start + a.dur, span.end)] as const).sort((x, y) => x[0] - y[0]);
    let cursor = span.start;
    for (const [s, e] of iv) {
      if (s - cursor > 2.5) add("warn", "dead-air", sec, `nothing moves from ${fmt(cursor)}s to ${fmt(s)}s`, sec);
      cursor = Math.max(cursor, e);
    }
    if (span.end - cursor > 2.5 && iv.length) add("warn", "dead-air", sec, `nothing moves from ${fmt(cursor)}s to ${fmt(span.end)}s`, sec);

    // No beat: ambient motion is not a beat. While the narration talks, something new should happen every ~4 s.
    const beats = anims.filter((a) => !AMBIENT.has(a.preset)).map((a) => [a.start, a.start + a.dur] as const).sort((x, y) => x[0] - y[0]);
    let bc = span.start;
    const talking = (a: number, b: number) => c.words.some((w) => w.start > a && w.start < b && /[A-Za-z0-9]/.test(w.text));
    for (const [s0, e0] of [...beats, [span.end, span.end] as const]) {
      if (s0 - bc > 4 && talking(bc, s0)) { add("warn", "no-beat", sec, `no new beat from ${fmt(bc)}s to ${fmt(s0)}s while the narration talks`, sec); break; }
      bc = Math.max(bc, e0);
    }

    // Busy: too many independent motions starting at once (a staggered entry counts once).
    const starts = [...new Map(anims.map((a) => [a.entry, a.start])).values()].sort((x, y) => x - y);
    for (let i = 0; i < starts.length; i++) {
      const j = starts.findIndex((t) => t > starts[i] + 0.3);
      const count = (j < 0 ? starts.length : j) - i;
      if (count > 3) { add("warn", "busy", sec, `${count} separate animations start within 0.3s of ${fmt(starts[i])}s`, sec); break; }
    }
  });

  // Sampled checks: offscreen, text overlap, reading time.
  const times: number[] = [];
  for (let t = 0; t <= c.duration; t += 0.25) times.push(t);
  const seen = new Set<string>();
  const readTime: Record<string, number> = {};
  for (const t of times) {
    const f = evaluate(c, t);
    const texts: { id: string; b: ReturnType<typeof visualBox> }[] = [];
    for (const [id, o] of Object.entries(c.objects)) {
      if (o.def.type === "group" || f.objects[id].hidden) continue;
      const b = visualBox(c, f, id);
      if (b.op < 0.05) continue;
      const pad = 4;
      if (b.x - b.w / 2 < -pad || b.x + b.w / 2 > W + pad || b.y - b.h / 2 < -pad || b.y + b.h / 2 > H + pad) {
        const key = `off:${id}:${f.section}`;
        if (!seen.has(key)) { seen.add(key); add("warn", "offscreen", id, `partly off-canvas at ${fmt(t)}s`, c.spans[f.section].id); }
      }
      if (o.def.type === "chip" && b.op > 0.6) readTime[id] = (readTime[id] ?? 0) + 0.25;
      if (o.def.type === "text") {
        if (b.op > 0.6 && f.objects[id].reveal > 0.95) readTime[id] = (readTime[id] ?? 0) + 0.25;
        if (b.op > 0.5) texts.push({ id, b });
      }
    }
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].b, b = texts[j].b;
        const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
        const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
        if (ox > 6 && oy > 6) {
          const key = `ov:${texts[i].id}:${texts[j].id}`;
          if (!seen.has(key)) { seen.add(key); add("warn", "overlap", `${texts[i].id} × ${texts[j].id}`, `text boxes overlap at ${fmt(t)}s`, c.spans[f.section].id); }
        }
      }
  }
  for (const [id, o] of Object.entries(c.objects)) {
    if (o.def.type !== "text") continue;
    const words = (o.def.text ?? "").split(/\s+/).filter(Boolean).length;
    const need = 0.25 * words + 0.4;
    const got = readTime[id] ?? 0;
    const ownerSec = typeof o.owner === "number" ? c.spans[o.owner].id : undefined;
    if (got > 0 && got < need) add("warn", "reading-time", id, `readable for ~${fmt(got)}s but ${words} words need ~${fmt(need)}s`, ownerSec);
    // Contrast against the background (or the rect it sits in).
    const at = o.def.at;
    const host = at && typeof at === "object" && at.in ? c.objects[at.in] : undefined;
    // A translucent host shows the background through it: blend its fill over the scene background.
    // With a gradient backdrop, check against its worst end.
    const tones = backdropTones(c.theme);
    const bgs = host && host.def.type === "rect" ? tones.map((t) => mixColor(t, host.base.fill, host.base.fillOpacity * host.base.opacity)) : tones;
    const scored = bgs.map((b) => ({ b, r: contrast(o.base.fill, b) })).filter((x) => x.r !== null) as { b: string; r: number }[];
    const worst = scored.sort((a, b) => a.r - b.r)[0];
    const bg = worst?.b ?? c.theme.palette.bg, ratio = worst ? worst.r : null;
    if (ratio !== null && ratio < 3) add("warn", "contrast", id, `text contrast ${ratio.toFixed(1)}:1 against ${bg} (aim for ≥ 4.5)`, ownerSec);
  }

  // Diagram geometry, checked on the settled frame at the end of each section (real positions,
  // visible objects only): arrows crossing boxes, boxes overlapping.
  const inside = (a: Box, b: Box) => a.x - a.w / 2 >= b.x - b.w / 2 - 1 && a.x + a.w / 2 <= b.x + b.w / 2 + 1 && a.y - a.h / 2 >= b.y - b.h / 2 - 1 && a.y + a.h / 2 <= b.y + b.h / 2 + 1;
  const geoSeen = new Set<string>();
  const sibling = (a: string, b: string) => !!c.objects[a].parent && c.objects[a].parent === c.objects[b].parent;
  c.spans.forEach((span, k) => {
    const f = evaluate(c, Math.max(span.start, span.end - 0.02), { section: k });
    const vis = (id: string) => !f.objects[id].hidden && effectiveOpacity(c, f, id) > 0.05;
    const boxes = Object.values(c.objects).filter((o) => o.def.type === "rect" && !o.def.frame && vis(o.id)).map((o) => ({ id: o.id, b: visualBox(c, f, o.id) as Box }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i], B = boxes[j];
        // Siblings in one group are a deliberate composition (e.g. a stacked deck of cards).
        if (inside(A.b, B.b) || inside(B.b, A.b) || sibling(A.id, B.id)) continue;
        const ox = Math.min(A.b.x + A.b.w / 2, B.b.x + B.b.w / 2) - Math.max(A.b.x - A.b.w / 2, B.b.x - B.b.w / 2);
        const oy = Math.min(A.b.y + A.b.h / 2, B.b.y + B.b.h / 2) - Math.max(A.b.y - A.b.h / 2, B.b.y - B.b.h / 2);
        const key = `bo:${A.id}:${B.id}`;
        if (ox > 4 && oy > 4 && !geoSeen.has(key)) { geoSeen.add(key); add("warn", "box-overlap", `${A.id} × ${B.id}`, `boxes overlap by ${Math.round(ox)}×${Math.round(oy)}px at ${fmt(span.end)}s`, span.id); }
      }
    for (const o of Object.values(c.objects)) {
      if ((o.def.type !== "arrow" && o.def.type !== "line") || !o.points || !vis(o.id)) continue;
      const ends = [o.def.from, o.def.to].filter((p): p is string => typeof p === "string").map((p) => splitPointRef(p).id);
      const related = (id: string) => ends.some((e) => e === id || isAncestor(id, e) || isAncestor(e, id) || sibling(id, e));
      const s0 = f.objects[o.id];
      const [[x1, y1], [x2, y2]] = o.points;
      for (const B of boxes) {
        if (related(B.id)) continue;
        // Require visible clearance (strokes are several px wide): grow the box rather than shrink it.
        const shrink = { ...B.b, w: B.b.w + 12, h: B.b.h + 12 };
        const key = `ac:${o.id}:${B.id}`;
        const pts = linePoints([x1 + s0.dx, y1 + s0.dy], [x2 + s0.dx, y2 + s0.dy], o.def.bend);
        const hit = pts.slice(1).some((p, i) => segmentHitsBox(pts[i][0], pts[i][1], p[0], p[1], shrink));
        if (!geoSeen.has(key) && hit) {
          geoSeen.add(key);
          add("warn", "arrow-crosses", `${o.id} × ${B.id}`, `arrow passes through or within 6px of "${B.id}"; reroute it (anchor, bend) or move the box`, span.id);
        }
      }
    }
  });

  // ---- house numbers (docs/motion.md) ----
  const first = c.spans[0]?.id, lastSec = c.spans[last]?.id;
  const visibleAt = (f: Frame, id: string) => {
    if (c.objects[id].def.type === "group" || f.objects[id].hidden) return 0;
    const s0 = f.objects[id], b = visualBox(c, f, id);
    const sc = b.w * b.h > 0 && s0.w * s0.h > 0 ? Math.sqrt((b.w * b.h) / (s0.w * s0.h)) : s0.scale;
    const part = (v: number) => Math.min(1, Math.max(0, v) / 0.15);
    // Word by word text is as visible as its most visible word.
    const wordsV = s0.words ? Math.max(0, ...s0.words.v) : 1;
    // By area: a shape shrunk to a quarter of its size is nearly gone.
    return b.op * Math.min(1, sc / 0.6) ** 2 * part(s0.draw) * part(s0.reveal) * part(s0.clip) * wordsV;
  };

  // Thumbnail: frame 0 of the video is its thumbnail and first impression.
  if (ctx.index === 0) {
    const f0 = evaluate(c, 0);
    if (!Object.keys(c.objects).some((id) => visibleAt(f0, id) > 0.5))
      add("warn", "thumbnail", first, `frame 0 shows only the backdrop. Start the first line early (at: -0.5, or "start-0.5") so the thumbnail shows the title or the subject`, first);
  }

  // End card: the last picture holds at least 3 s.
  if (ctx.index === ctx.count - 1 && c.duration > 6) {
    const late = [...(c.anims[last] ?? []), ...c.through].filter((a) => !AMBIENT.has(a.preset) && PRESETS[a.preset]?.kind !== "loop" && a.start + a.dur > c.duration - 3 + 0.05);
    if (late.length) {
      const lastA = late.reduce((a, b) => (b.start + b.dur > a.start + a.dur ? b : a)), endsAt = lastA.start + lastA.dur;
      add("warn", "end-hold", lastSec, `the final picture holds ${fmt(Math.max(0, c.duration - endsAt))}s (aim for ≥ 3 s): ${lastA.preset} → ${lastA.target} runs until ${fmt(endsAt)}s`, lastSec);
    }
  }

  // Open calm: at most one camera move in the first 5 s, and it is measured (≥ 1 s).
  if (ctx.index === 0) {
    const cam = [...c.anims.flat(), ...c.through].filter((a) => a.target === CAMERA && !AMBIENT.has(a.preset) && a.start < 5);
    const fast = cam.find((a) => a.dur < 1);
    if (cam.length > 1) add("warn", "open-calm", first, `${cam.length} camera moves start in the first 5 s; open with at most one measured push (1.2–1.5 s)`, first);
    else if (fast) add("warn", "open-calm", first, `a ${fmt(fast.dur)}s camera move at ${fmt(fast.start)}s: in the first 5 s, push slowly (1.2–1.5 s)`, first);
  }

  // Per-frame checks at the video's frame rate: snaps (visible → gone in one frame) and flashes.
  {
    const dt = 1 / (c.fps || 30);
    const prev: Record<string, number> = {}, prevLum: Record<string, number> = {};
    const flips: Record<string, number[]> = {};
    const snapSeen = new Set<string>(), flashSeen = new Set<string>();
    const boundary = (t: number) => c.spans.some((sp) => Math.abs(t - sp.end) < dt * 1.5 || Math.abs(t - sp.start) < dt * 1.5);
    for (let i = 0, t = 0; t <= c.duration + 1e-9; i++, t = i * dt) {
      const f = evaluate(c, t);
      for (const id of Object.keys(c.objects)) {
        if (c.objects[id].def.type === "group") continue;
        const v = visibleAt(f, id), pv = prev[id];
        const owner = c.objects[id].owner, sec = typeof owner === "number" ? c.spans[owner].id : c.spans[f.section].id;
        if (pv !== undefined && pv > 0.6 && v < 0.05 && !boundary(t) && !snapSeen.has(id)) {
          snapSeen.add(id);
          add("warn", "snap-off", id, `disappears in one frame at ${fmt(t)}s; give it an exit (fade-out, sink-out, clear, …)`, sec);
        }
        const lum = luminance(f.objects[id].fill) ?? 0;
        const flipped = (pv !== undefined && (pv > 0.5) !== (v > 0.5)) || (prevLum[id] !== undefined && v > 0.3 && Math.abs(lum - prevLum[id]) > 0.25);
        if (flipped) {
          const list = (flips[id] ??= []);
          list.push(t);
          while (list.length && list[0] < t - 1) list.shift();
          if (list.length > 6 && !flashSeen.has(id)) {
            flashSeen.add(id);
            add("error", "flash", id, `flashes more than 3 times a second around ${fmt(t)}s (a seizure risk)`, sec);
          }
        }
        prev[id] = v; prevLum[id] = lum;
      }
    }
  }

  // Text too small to read on a phone (once settled: entrances and exits scale through small sizes),
  // and per-object style checks.
  {
    const small = new Set<string>();
    const all = [...c.anims.flat(), ...c.through].filter((a) => !AMBIENT.has(a.preset));
    const moving = (id: string, t: number) => {
      for (let x: string | undefined = id; x; x = c.objects[x]?.parent) if (all.some((a) => a.target === x && t >= a.start && t <= a.start + a.dur)) return true;
      return all.some((a) => a.target === CAMERA && t >= a.start && t <= a.start + a.dur);
    };
    for (const t of times) {
      const f = evaluate(c, t);
      for (const [id, o] of Object.entries(c.objects)) {
        if (!o.font || small.has(id) || f.objects[id].hidden) continue;
        const b = visualBox(c, f, id), s0 = f.objects[id];
        if (b.op < 0.5 || s0.reveal < 0.95 || moving(id, t)) continue;
        // visualBox already multiplies the object's and its ancestors' scale into its width.
        const px = o.font.size * (s0.w > 0 ? b.w / s0.w : s0.scale) * (o.def.hud ? 1 : f.camera.scale);
        if (px < MIN_TEXT_PX - 0.5) {
          small.add(id);
          const ownerSec = typeof o.owner === "number" ? c.spans[o.owner].id : c.spans[f.section].id;
          add("warn", "small-text", id, `text renders at ${px.toFixed(0)} px at ${fmt(t)}s (keep text ≥ ${MIN_TEXT_PX} px on screen)`, ownerSec);
        }
      }
    }
  }
  for (const [id, o] of Object.entries(c.objects)) {
    const d = o.def, ownerSec = typeof o.owner === "number" ? c.spans[o.owner].id : undefined;
    const hexes = (["fill", "stroke", "labelColor"] as const).filter((k) => typeof d[k] === "string" && /^#/.test(d[k] as string));
    if (hexes.length) add("warn", "raw-color", id, `${hexes.map((k) => `${k} ${d[k]}`).join(", ")}: use a palette token (add it to theme.json) so one change recolors the film`, ownerSec);
    const at = d.at;
    if (at && typeof at === "object") {
      if (at.x !== undefined) add("warn", "raw-pixels", id, `absolute x/y placement: use a region or a relative placement`, ownerSec);
      else if (Math.abs(at.dx ?? 0) > 200 || Math.abs(at.dy ?? 0) > 200) add("warn", "raw-pixels", id, `nudged ${at.dx ?? 0},${at.dy ?? 0} px: a region or relative placement would hold up better`, ownerSec);
    }
  }

  // Product UI only eases: no overshoot, spring, wobble or breathing on it.
  {
    const isUi = (id: string) => { for (let x: string | undefined = id; x; x = c.objects[x]?.parent) { const d = c.objects[x]?.def; if (d?.ui || d?.type === "video") return true; } return false; };
    const seenUi = new Set<string>();
    c.anims.forEach((list, k) => {
      for (const a of list) {
        if (a.target === CAMERA || !isUi(a.target) || seenUi.has(a.target)) continue;
        const easeName = a.ease ?? PRESETS[a.preset]?.ease;
        if (["pop", "wobble", "breathe", "sway"].includes(a.preset) || BOUNCY.has(easeName ?? "")) {
          seenUi.add(a.target);
          add("warn", "ui-bounce", a.target, `${a.preset}${a.ease ? ` (ease ${a.ease})` : ""} on product UI at ${fmt(a.start)}s: UI only eases (fade, rise-in, to with out/inOut)`, c.spans[k].id);
        }
      }
    });
  }

  // Walkthroughs (docs/motion.md §7): measured camera moves, holds on
  // what the camera finds, short chips that stay up long enough and never cover what they name.
  {
    const cam = [...c.anims.flat(), ...c.through].filter((a) => a.target === CAMERA && !AMBIENT.has(a.preset)).sort((a, b) => a.start - b.start);
    const secAt = (t: number) => c.spans.find((sp) => t >= sp.start && t < sp.end)?.id ?? lastSec;
    cam.forEach((a, i) => {
      if (a.dur < 0.55 && !(ctx.index === 0 && a.start < 5)) add("warn", "camera-speed", CAMERA, `a ${fmt(a.dur)}s camera move at ${fmt(a.start)}s: camera moves take 0.55–1.2 s`, secAt(a.start));
      if (a.preset !== "focus") return;
      if (a.params.z > 1 && a.params.z < 1.6 && a.params.zoom === undefined)
        add("warn", "focus-zoom", CAMERA, `focus on ${a.params.on} at ${fmt(a.start)}s zooms only ${a.params.z.toFixed(2)}×: pick the smaller region the beat is about (beats zoom 1.6–2.4×)`, secAt(a.start));
      const next = cam[i + 1], end = a.start + a.dur;
      if (a.params.z > 1 && next && next.start - end < 1.4)
        add("warn", "focus-hold", CAMERA, `holds ${fmt(Math.max(0, next.start - end))}s on ${a.params.on} before the next camera move at ${fmt(next.start)}s: hold 1.4–2.2 s on every point of interest`, secAt(a.start));
    });
    for (const o of Object.values(c.objects)) {
      if (o.def.type !== "chip") continue;
      const sec = typeof o.owner === "number" ? c.spans[o.owner].id : undefined;
      const words = (o.def.text ?? "").split(/\s+/).filter(Boolean).length;
      if (words > 6) add("warn", "chip-words", o.id, `${words} words: a chip is a label, not a sentence (≤ 6 words)`, sec);
      const got = readTime[o.id] ?? 0;
      if (got > 0 && got < 1.2) add("warn", "chip-time", o.id, `on screen ~${fmt(got)}s: chips stay up 1.2–1.6 s at least`, sec);
      const ref = typeof o.def.to === "string" ? splitPointRef(o.def.to).id : undefined, a = c.layout[o.id], b = ref ? c.layout[ref] : undefined;
      if (a && b && ref !== o.id) {
        const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
        const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
        const inside = a.x - a.w / 2 >= b.x - b.w / 2 && a.x + a.w / 2 <= b.x + b.w / 2 && a.y - a.h / 2 >= b.y - b.h / 2 && a.y + a.h / 2 <= b.y + b.h / 2;
        // A chip inside a big container (the app window) is fine; one sitting on the thing it names is not.
        if (ox > 4 && oy > 4 && !inside) add("warn", "chip-over", o.id, `covers "${ref}", the thing it names: put the chip beside it, in the dimmed area, on its leader line`, sec);
      }
    }
  }

  // Scenes hard-cut: a scene that isn't last clears itself before its cut.
  if (ctx.index < ctx.count - 1) {
    const fEnd = evaluate(c, c.duration);
    const left = Object.keys(c.objects).filter((id) => visibleAt(fEnd, id) > 0.3);
    if (left.length) add("warn", "scene-exit", lastSec, `${left.length} object(s) still on screen at the cut to the next scene (${left.slice(0, 4).join(", ")}${left.length > 4 ? ", …" : ""}); clear them over the last ~0.6 s`, lastSec);
  }

  // Cues in the narration that nothing uses.
  const all = [...c.anims.flat(), ...c.through];
  for (const [name, t] of Object.entries(c.cues)) {
    const hit = all.some((a) => Math.abs(a.start - t) < 0.6);
    const inSpan = c.spans.find((sp) => t >= sp.start && t < sp.end);
    if (inSpan?.placeholder) continue;
    if (!hit) add("warn", "unused-cue", name, `cue at ${fmt(t)}s has no animation near it`, inSpan?.id);
  }
  return issues;
}
