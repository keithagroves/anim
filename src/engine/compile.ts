import { computeLayout, regions, splitPointRef, textMetrics } from "./layout.js";
import { PRESETS } from "./presets.js";
import { ease as getEase } from "./ease.js";
import { color, size, type Theme } from "./theme.js";
import { globToRegex, resolveTime, splitSections } from "./timing.js";
import { parseSketch, sketchBox, sketchMarkup } from "./sketch.js";
import type { Box, CAnim, CObj, CScene, Entry, ObjDef, Placement, ProjectFile, Props, SceneFile, SectionFile, Words } from "./types.js";

export interface SceneInput {
  project: ProjectFile;
  theme: Theme;
  scene: SceneFile;
  /** One per scene.sections entry; null when the section file doesn't exist yet. */
  sections: (SectionFile | null)[];
  words?: Words;
  audio?: string;
  clips?: Record<string, import("./types.js").ClipInfo>;
}

export const CAMERA = "camera";

function refsOf(at: Placement | undefined): string[] {
  if (!at || typeof at === "string") return [];
  return (["in", "below", "above", "leftOf", "rightOf"] as const).map((k) => at[k]).filter((v): v is string => !!v);
}

/** Greedy word wrap to at most `lines` lines of `width` characters (the last one ends in … if cut). */
function wrapWords(text: string, width: number, lines: number): string {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((cur + " " + w).trim().length > width) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out.length > lines ? [...out.slice(0, lines - 1), out[lines - 1].slice(0, width - 1) + "…"].join("\n") : out.join("\n");
}

export function compileScene(inp: SceneInput): { scene: CScene; errors: string[] } {
  const errors: string[] = [];
  const { project, theme, scene } = inp;
  const [W, H] = project.size;

  // ---- objects and ownership ----
  const objs: Record<string, ObjDef> = {};
  const owner: Record<string, "scene" | number> = {};
  for (const [id, d] of Object.entries(scene.objects)) {
    const at = d.at ?? scene.stage?.[id];
    objs[id] = at !== undefined ? { ...d, at } : d;
    owner[id] = "scene";
  }
  for (const id of Object.keys(scene.stage ?? {})) if (!objs[id]) errors.push(`stage: unknown object "${id}"`);

  // A section not written yet shows a name card (its id and brief) for its span, so the video plays
  // with holes while agents work, instead of failing to compile.
  for (const sec of scene.sections) if (sec.sketch) for (const e of parseSketch(sec.sketch).errors) errors.push(`${sec.id} sketch: ${e}`);
  scene.sections.forEach((sec, k) => {
    if (inp.sections[k]) return;
    const p = `${sec.id}.~`;
    // With a storyboard sketch, the placeholder shows the planned frame, full size, behind its card.
    if (sec.sketch) {
      objs[p + "sketch"] = { type: "svg", svg: sketchMarkup(sec.sketch, theme, { rough: true, gray: true, id: `${sec.id}-ph`, size: [W, H] }), viewBox: `0 0 ${sketchBox([W, H]).join(" ")}`, w: W, h: H, at: "full", layer: 999 };
      owner[p + "sketch"] = k;
    }
    const brief = wrapWords(sec.brief, 84, 2);
    objs[p + "card"] = { type: "rect", w: 1400, h: 96 + 36 * brief.split("\n").length, radius: "md", fill: "surface", stroke: "line", dash: "12 10", opacity: 0.92, at: { region: "bottom" }, layer: 1000 };
    objs[p + "name"] = { type: "text", text: `${sec.id} · not written yet`, style: "label", anchor: "start", at: { in: p + "card", align: "top-left", pad: "md" }, layer: 1001 };
    objs[p + "brief"] = { type: "text", text: brief, style: "small", anchor: "start", at: { below: p + "name", gap: "xs", align: "left" }, layer: 1001 };
    for (const id of ["card", "name", "brief"]) owner[p + id] = k;
  });

  scene.sections.forEach((sec, k) => {
    const f = inp.sections[k];
    if (!f) return;
    if (f.id !== sec.id) errors.push(`section file for "${sec.id}" has id "${f.id}"`);
    for (const [id, d] of Object.entries(f.objects ?? {})) {
      if (!id.startsWith(sec.id + ".")) errors.push(`${sec.id}: local object "${id}" must be prefixed "${sec.id}."`);
      if (objs[id]) { errors.push(`${sec.id}: object "${id}" already exists`); continue; }
      objs[id] = d;
      owner[id] = k;
    }
  });

  const visibleTo = (id: string, k: number | "scene") => owner[id] === "scene" || owner[id] === k;

  const parentOf: Record<string, string> = {};
  for (const [id, d] of Object.entries(objs)) {
    for (const r of [...refsOf(d.at), ...[d.from, d.to].filter((p): p is string => typeof p === "string").map((p) => splitPointRef(p).id)])
      if (objs[r] && !visibleTo(r, owner[id])) errors.push(`${id}: cannot reference "${r}" (owned by another section)`);
    if (d.type !== "group") continue;
    for (const kid of d.children ?? []) {
      if (!objs[kid]) errors.push(`${id}: unknown child "${kid}"`);
      else if (parentOf[kid]) errors.push(`${kid}: has two parents (${parentOf[kid]}, ${id})`);
      else if (owner[kid] !== owner[id]) errors.push(`${id}: child "${kid}" must have the same owner as its group`);
      else parentOf[kid] = id;
    }
  }

  // ---- layout ----
  const L = computeLayout(objs, parentOf, theme, W, H);
  errors.push(...L.errors);
  const canvasBox: Box = { x: W / 2, y: H / 2, w: W, h: H };

  const objects: Record<string, CObj> = {};
  for (const [id, d] of Object.entries(objs)) {
    const box = L.layout[id];
    const isLine = d.type === "line" || d.type === "arrow";
    let fillDefault = "none", strokeDefault = "none", font: CObj["font"];
    if (d.type === "rect") fillDefault = "surface";
    if (d.type === "circle") fillDefault = "accent";
    if (d.type === "path") fillDefault = "text";
    if (isLine) strokeDefault = "muted";
    let labelFill: string | undefined;
    if (d.type === "rect" && d.text) {
      try {
        const m = textMetrics({ ...d, style: d.style ?? (d.frame ? "small" : "label") }, theme);
        font = m.font;
        labelFill = color(theme, d.labelColor, color(theme, theme.text[d.style ?? (d.frame ? "small" : "label")].fill ?? "text"));
      } catch (e: any) { errors.push(`${id}: ${e.message}`); }
      if (d.frame && d.stroke === undefined) strokeDefault = "line";
      if (d.frame && d.fill === undefined) fillDefault = "none";
    }
    if ((d.type === "arrow" || d.type === "line") && d.text) {
      try { font = textMetrics({ ...d, style: d.style ?? "small" }, theme).font; labelFill = color(theme, d.labelColor, color(theme, "muted")); }
      catch (e: any) { errors.push(`${id}: ${e.message}`); }
    }
    if (d.type === "chip") {
      // A caption chip: a light pill with dark words, on a leader line to what it names.
      try { font = textMetrics({ ...d, style: d.style ?? "label" }, theme).font; } catch (e: any) { errors.push(`${id}: ${e.message}`); }
      fillDefault = "text";
      labelFill = color(theme, d.labelColor, color(theme, "bg"));
      if (!d.text) errors.push(`${id}: chip needs "text"`);
    }
    // Spotlight defaults: rgba(20,20,19, .55 × amount), radius 18, pad 24.
    if (d.type === "spotlight") fillDefault = "#141413";
    if (d.type === "text") {
      try {
        const m = textMetrics(d, theme);
        font = m.font;
        fillDefault = theme.text[d.style ?? "body"].fill ?? "text";
      } catch (e: any) { errors.push(`${id}: ${e.message}`); }
    }
    let strokeWidth = 0, radius = 0;
    try {
      strokeWidth = size(theme, "stroke", d.strokeWidth, d.stroke || isLine || d.frame ? theme.stroke.md : 0);
      radius = d.type === "chip" ? box.h / 2 : size(theme, "radius", d.radius, d.type === "spotlight" ? 18 : theme.radius.md);
    } catch (e: any) { errors.push(`${id}: ${e.message}`); }
    const base: Props = {
      opacity: d.opacity ?? 1, scale: 1, rotate: 0, dx: 0, dy: 0, w: box.w, h: box.h,
      fill: color(theme, d.fill, color(theme, fillDefault)),
      stroke: color(theme, d.stroke, color(theme, strokeDefault)),
      strokeWidth, fillOpacity: d.fillOpacity ?? (d.type === "spotlight" ? 0.55 : 1), draw: 1, reveal: 1, clip: 1, value: d.value ?? 0, time: 0,
    };
    if (d.type === "video" && (!d.src || !inp.clips?.[d.src])) errors.push(`${id}: video needs a "src" clip file that exists (got ${JSON.stringify(d.src)})`);
    objects[id] = { id, def: d, owner: owner[id], parent: parentOf[id], base, points: L.points[id], font, radius, labelFill };
  }

  // ---- timing ----
  const words = inp.words;
  const duration = words?.duration ?? Math.max(...scene.sections.map((s) => s.target[1]));
  const spans = splitSections(scene.sections.map((s) => s.target), duration, words?.words).map((s, k) => ({
    ...s, id: scene.sections[k].id, brief: scene.sections[k].brief, ...(inp.sections[k] ? {} : { placeholder: true }),
  }));
  const cues = words?.cues ?? {};

  // ---- patches (keys, `to`) ----
  function resolvePatch(p: Record<string, any>, id: string, where: string): Partial<Props> {
    const out: any = {};
    const box = L.layout[id] ?? canvasBox;
    for (const [k, v] of Object.entries(p)) {
      try {
        if (k === "fill" || k === "stroke") out[k] = color(theme, v);
        else if (k === "w" || k === "h") out[k] = size(theme, "space", v, 0);
        else if (k === "strokeWidth") out[k] = size(theme, "stroke", v, 0);
        else if (k === "at") {
          const [x, y] = L.place(v, box.w, box.h, where);
          out.dx = x - box.x;
          out.dy = y - box.y;
        } else out[k] = v;
      } catch (e: any) { errors.push(`${where}: ${e.message}`); }
    }
    return out;
  }

  const keyNames = new Set(["0", ...scene.sections.map((s) => s.id)]);
  for (const name of Object.keys(scene.keys)) if (!keyNames.has(name)) errors.push(`keys: unknown key "${name}" (use "0" or a section id = state at the end of that section)`);
  const keysAt: Record<string, Partial<Props>>[] = [];
  const applyKey = (acc: Record<string, Partial<Props>>, name: string) => {
    for (const [id, patch] of Object.entries(scene.keys[name] ?? {})) {
      if (owner[id] !== "scene") { errors.push(`keys.${name}: "${id}" is not a scene object`); continue; }
      acc[id] = { ...acc[id], ...resolvePatch(patch, id, `keys.${name}.${id}`) };
    }
  };
  let acc: Record<string, Partial<Props>> = {};
  applyKey(acc, "0");
  scene.sections.forEach((sec, k) => {
    keysAt.push(structuredClone(acc));
    if (k < scene.sections.length - 1) applyKey(acc, sec.id);
  });

  // ---- timelines ----
  const durOf = (v: number | string, start: number, spanEnd: number): number => {
    if (typeof v === "number") return v;
    if (v === "all") return Math.max(0, duration - start);
    if (v === "rest") return Math.max(0, spanEnd - start);
    if (v === "fast" || v === "base" || v === "slow") return theme.timing[v] * theme.timing.scale;
    throw new Error(`unknown duration "${v}" (seconds, fast|base|slow, "rest" or "all")`);
  };

  function resolveTimeline(entries: Entry[], spanStart: number, spanEnd: number, label: string, k: number | "scene"): CAnim[] {
    const out: CAnim[] = [];
    const refs = new Map<string, { start: number; end: number }>();
    let prevEnd = spanStart;
    entries.forEach((e, idx) => {
      // `clear` with no target clears every local object of the section.
      const target = e.target ?? (e.preset === "clear" && typeof k === "number" ? `${label}.*` : undefined);
      const targetLabel = Array.isArray(target) ? target.join(", ") : target ?? "?";
      const where = `${label}.timeline[${idx}] (${e.preset} → ${targetLabel})`;
      if (target === undefined) { errors.push(`${where}: needs "target"`); return; }
      const preset = PRESETS[e.preset];
      if (!preset) { errors.push(`${where}: unknown preset (have: ${Object.keys(PRESETS).join(", ")})`); return; }
      try { getEase(e.ease, preset.ease); } catch (err: any) { errors.push(`${where}: ${err.message}`); return; }

      let targets: string[] = [];
      for (const spec of Array.isArray(target) ? target : [target]) {
        if (spec === CAMERA) { targets.push(CAMERA); continue; }
        if (spec.includes("*")) {
          const re = globToRegex(spec);
          const hits = Object.keys(objs).filter((id) => re.test(id) && visibleTo(id, k));
          if (!hits.length) { errors.push(`${where}: pattern "${spec}" matches no objects`); return; }
          targets.push(...hits);
          continue;
        }
        if (!objs[spec]) { errors.push(`${where}: unknown object "${spec}"`); return; }
        if (!visibleTo(spec, k)) { errors.push(`${where}: object "${spec}" belongs to another section`); return; }
        targets.push(spec);
      }
      // A clear moves whole things: drop targets inside another target (a group and its children would move twice).
      if (e.preset === "clear") {
        const set = new Set(targets);
        const inside = (id: string) => { for (let p = parentOf[id]; p; p = parentOf[p]) if (set.has(p)) return true; return false; };
        targets = targets.filter((id) => !inside(id));
      }

      let base: number;
      if (e.at !== undefined) {
        if (typeof e.at === "number") base = spanStart + e.at;
        else {
          try { base = resolveTime(e.at, { start: spanStart, end: spanEnd, cues, spans }); }
          catch (err: any) { errors.push(`${where}: ${err.message}`); return; }
        }
        base += e.offset ?? 0;
      } else if (e.after !== undefined) {
        const r = refs.get(e.after);
        if (!r) { errors.push(`${where}: "after" refers to "${e.after}", which has no earlier entry in this timeline`); return; }
        base = r.end + (e.gap ?? 0);
      } else if (e.with !== undefined) {
        const r = refs.get(e.with);
        if (!r) { errors.push(`${where}: "with" refers to "${e.with}", which has no earlier entry in this timeline`); return; }
        base = r.start + (e.offset ?? 0);
      } else base = prevEnd + (e.gap ?? 0);

      let gStart = Infinity, gEnd = -Infinity;
      // A clear's default stagger fits the whole set into ~0.25 s, so many objects never overrun the cut.
      const stagger = e.stagger ?? (e.preset === "clear" && targets.length > 1 ? Math.min(0.06, 0.25 / (targets.length - 1)) : 0);
      targets.forEach((tgt, i) => {
        const start = base + i * stagger;
        let dur: number;
        try { dur = durOf(e.dur ?? preset.dur, start, spanEnd); } catch (err: any) { errors.push(`${where}: ${err.message}`); return; }
        const params: Record<string, any> = { index: i };
        for (const p of ["distance", "amount", "cycles", "overshoot", "spin", "period", "pace", "side", "anticipate", "zoom"] as const) if (e[p] !== undefined) params[p] = e[p];
        if (preset.prepare) {
          try {
            const box = L.layout[tgt] ?? canvasBox;
            const r = preset.prepare({
              entry: e, target: tgt, def: objs[tgt] ?? { type: "group" }, box,
              patch: (p) => resolvePatch(p, tgt, where),
              center: (ref) => {
                if (typeof ref === "string" && objs[ref]) { const b = L.layout[ref]; return [b.x, b.y]; }
                return L.place(ref, box.w, box.h, where);
              },
              boxOf: (ref) => {
                if (typeof ref === "string" && objs[ref]) return L.layout[ref];
                const p = typeof ref === "string" ? { region: ref } : ref;
                if (p.region) { const r = regions(W, H, theme.safe)[p.region]; if (r) return r; }
                const [x, y] = L.place(ref, box.w, box.h, where);
                return { x, y, w: box.w, h: box.h };
              },
              color: (c) => color(theme, c),
            });
            Object.assign(params, r.params);
            if (r.dur !== undefined) dur = r.dur;
          } catch (err: any) { errors.push(`${where}: ${err.message}`); return; }
        }
        out.push({ target: tgt, preset: e.preset, start, dur, ease: e.ease, params, entry: idx });
        refs.set(tgt, { start, end: start + dur });
        gStart = Math.min(gStart, start);
        gEnd = Math.max(gEnd, start + dur);
      });
      if (gEnd === -Infinity) return;
      const r = { start: gStart, end: gEnd };
      refs.set(targetLabel, r);
      if (Array.isArray(target)) for (const t of target) if (!refs.has(t)) refs.set(t, r);
      if (e.id) refs.set(e.id, r);
      prevEnd = gEnd;
    });
    return out.sort((a, b) => a.start - b.start || a.entry - b.entry);
  }

  const anims = scene.sections.map((sec, k) => {
    const f = inp.sections[k];
    return f ? resolveTimeline(f.timeline, spans[k].start, spans[k].end, sec.id, k) : [];
  });
  const through = resolveTimeline(scene.through, 0, duration, "through", "scene");

  const order = Object.keys(objs);
  for (const id of order) if (objs[id].hud && parentOf[id]) errors.push(`${id}: "hud" works on root objects only (it is inside ${parentOf[id]})`);
  // A spotlight dims everything else, so by default it sits above the scene, and caption chips above it
  // (both under placeholder cards).
  const layerOf = (id: string) => objs[id].layer ?? ({ spotlight: 900, chip: 950 } as Record<string, number>)[objs[id].type] ?? 0;
  const roots = order
    .filter((id) => !parentOf[id])
    .sort((a, b) => layerOf(a) - layerOf(b) || order.indexOf(a) - order.indexOf(b));

  return {
    errors,
    scene: {
      id: scene.id, size: project.size, fps: project.fps, duration, theme,
      objects, roots, layout: L.layout, spans, keysAt, anims, through, cues,
      words: words?.words ?? [], audio: inp.audio, clips: inp.clips,
    },
  };
}
