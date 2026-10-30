import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PageRecordType, Tldraw, createShapeId, compressLegacySegments, toRichText, renderPlaintextFromRichText, type Editor, type TLShapeId } from "tldraw";
import "tldraw/tldraw.css";
import { GRID, Talk } from "./talk";

type Pt = [number, number];
type Color = "black" | "grey" | "light-violet" | "violet" | "blue" | "light-blue" | "yellow" | "orange" | "green" | "light-green" | "light-red" | "red" | "white";
type Size = "s" | "m" | "l" | "xl";

/** Commands the broker delivers. Coordinates are page units; `ms` is how long the drawing takes. */
type Cmd =
  | { op: "clear" }
  | { op: "wait"; ms: number }
  | { op: "fit"; ms?: number }
  | { op: "camera"; x: number; y: number; zoom?: number; ms?: number }
  | { op: "stroke"; points: Pt[]; color?: Color; size?: Size; dash?: "draw" | "solid" | "dashed" | "dotted"; closed?: boolean; fill?: "none" | "semi" | "solid"; ms?: number }
  | { op: "text"; x: number; y: number; text: string; color?: Color; size?: Size; font?: "draw" | "sans" | "serif" | "mono"; name?: string; ms?: number }
  | { op: "geo"; geo: string; x: number; y: number; w: number; h: number; color?: Color; fill?: "none" | "semi" | "solid" | "pattern"; dash?: "draw" | "solid" | "dashed" | "dotted"; text?: string; size?: Size; font?: "draw" | "sans" | "serif" | "mono"; name?: string; ms?: number }
  | { op: "frame"; x: number; y: number; w: number; h: number; label: string; color?: Color; name?: string; ms?: number }
  | { op: "arrow"; from: Pt | string; to: Pt | string; fromAnchor?: { x: number; y: number }; toAnchor?: { x: number; y: number }; bend?: number; color?: Color; size?: Size; dash?: "draw" | "solid" | "dashed" | "dotted"; text?: string; ms?: number }
  | { op: "status"; text: string }
  | { op: "move"; tag: string; dx: number; dy: number; ms?: number; ease?: "in" | "inOut" }
  | { op: "remove"; name: string; ms?: number }
  | { op: "highlight"; name: string; ms?: number }
  | { op: "focus"; name: string; ms?: number }
  | { op: "option"; name: string; x: number; y: number; label: string; pros?: string[]; cons?: string[]; color?: Color; ms?: number }
  | { op: "pick"; name: string; ms?: number }
  | { op: "page"; name: string }
  | { op: "update"; name: string; x?: number; y?: number; w?: number; h?: number; ms?: number }
  | { op: "bounds"; x: number; y: number; w: number; h: number; ms?: number }
  | { op: "audio"; src: string };

/** Shapes created by commands carrying `tag`, so they can be moved together later. */
const tags = new Map<string, TLShapeId[]>();
/** Named shapes, so arrows can start and end on them. */
const names = new Map<string, TLShapeId>();
/** Trade-offs: the options laid out since the last pick, and the pros/cons notes under each option. */
const weighing = new Set<string>();
const optionNotes = new Map<string, TLShapeId[]>();
/** For each picked option, the alternatives it beat. */
const rivalsOf = new Map<string, string[]>();
const remember = (c: any, id: TLShapeId) => {
  if (c.tag) (tags.get(c.tag) ?? tags.set(c.tag, []).get(c.tag)!).push(id);
  if (c.name) names.set(c.name, id);
};

/** Where a ray from a box's centre towards `toward` leaves the box. */
function edgePoint(editor: Editor, id: TLShapeId, toward: Pt): Pt {
  const b = editor.getShapePageBounds(id)!;
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = toward[0] - cx, dy = toward[1] - cy;
  const t = Math.min(b.w / 2 / (Math.abs(dx) || 1e-9), b.h / 2 / (Math.abs(dy) || 1e-9));
  return [cx + dx * Math.min(t, 1), cy + dy * Math.min(t, 1)];
}
const centerOf = (editor: Editor, id: TLShapeId): Pt => { const b = editor.getShapePageBounds(id)!; return [b.x + b.w / 2, b.y + b.h / 2]; };

/**
 * Next animation step: an animation frame, or a timer if the tab is hidden (rAF pauses in background tabs).
 * Progress is computed from the wall clock, so a throttled background tab still finishes correctly.
 */
const frame = () => new Promise<void>((r) => {
  let done = false;
  const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(go);
  setTimeout(go, 40);
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run `fn(progress)` every frame for `ms` milliseconds, ending at progress 1. */
async function animate(ms: number, fn: (p: number) => void) {
  const start = performance.now();
  for (;;) {
    const p = Math.min(1, (performance.now() - start) / Math.max(1, ms));
    fn(p);
    if (p >= 1) return;
    await frame();
  }
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

async function run(editor: Editor, c: Cmd) {
  switch (c.op) {
    case "clear": {
      // Wipes the current page only.
      const ids = [...editor.getCurrentPageShapeIds()];
      editor.deleteShapes(ids);
      tags.clear();
      for (const [n, id] of names) if (ids.includes(id)) names.delete(n);
      weighing.clear();
      optionNotes.clear();
      rivalsOf.clear();
      return;
    }
    case "page": {
      // Turn to the page for a topic, like a fresh sheet on a flip chart: created (titled with its name) the first
      // time, revisited by name after that.
      const name = c.name.trim();
      let page = editor.getPages().find((p) => p.name.toLowerCase() === name.toLowerCase());
      const current = editor.getCurrentPage();
      if (!page && editor.getCurrentPageShapeIds().size === 0) { editor.renamePage(current.id, name); page = editor.getCurrentPage(); }
      if (page?.id !== current.id) {
        const canvas = document.querySelector<HTMLElement>(".tl-canvas");
        if (canvas) { canvas.style.transition = "opacity 180ms"; canvas.style.opacity = "0"; }
        await sleep(180);
        if (!page) { const id = PageRecordType.createId(); editor.createPage({ id, name }); page = editor.getPage(id)!; }
        editor.setCurrentPage(page.id);
        if (editor.getCurrentPageShapeIds().size === 0) editor.setCamera({ x: COVERED.left + 60, y: COVERED.top + 200, z: 1 });
        else keepInView(editor, 0);
        if (canvas) canvas.style.opacity = "1";
        await sleep(180);
      }
      const title = `title:${page!.id}`;
      if (!names.has(title)) await run(editor, { op: "text", name: title, x: 0, y: -150, text: page!.name, size: "l", ms: 500 });
      return;
    }
    case "remove": {
      // Fade out and delete a named shape, with the arrows attached to it (they'd be left dangling).
      const id = names.get(c.name);
      if (!id || !editor.getShape(id)) return;
      const gone = [id, ...editor.getBindingsToShape(id, "arrow").map((b) => b.fromId)].filter((g, i, all) => all.indexOf(g) === i && editor.getShape(g));
      await animate(c.ms ?? 300, (p) => editor.updateShapes(gone.map((g) => ({ id: g, type: editor.getShape(g)!.type, opacity: 1 - ease(p) }))));
      editor.deleteShapes(gone);
      for (const [n, s] of names) if (gone.includes(s)) names.delete(n);
      return;
    }
    case "update": {
      // Move/resize a named shape (used when a streamed scene changes); bound arrows follow.
      const id = names.get(c.name);
      const sh = id && editor.getShape(id);
      if (!sh) return;
      // Moving an option into the design ends its comparison: its pros and cons, and the alternatives it beat, are erased.
      if (optionNotes.has(c.name)) {
        const rivals = rivalsOf.get(c.name) ?? [];
        const gone = [...optionNotes.get(c.name)!, ...rivals.flatMap((n) => [names.get(n), ...(optionNotes.get(n) ?? [])])]
          .filter((x): x is TLShapeId => !!x && !!editor.getShape(x));
        const o0 = new Map(gone.map((g) => [g, editor.getShape(g)!.opacity]));
        await animate(250, (p) => editor.updateShapes(gone.map((g) => ({ id: g, type: editor.getShape(g)!.type, opacity: o0.get(g)! * (1 - p) }))));
        editor.deleteShapes(gone);
        for (const n of [c.name, ...rivals]) optionNotes.delete(n);
        for (const n of rivals) names.delete(n);
      }
      const from = { x: sh.x, y: sh.y, w: (sh.props as any).w, h: (sh.props as any).h };
      await animate(c.ms ?? 300, (p) => {
        const e = ease(p);
        const lerp = (a: number, b: number | undefined) => (b === undefined ? a : a + (b - a) * e);
        const props: any = {};
        if (c.w !== undefined && from.w !== undefined) props.w = lerp(from.w, c.w);
        if (c.h !== undefined && from.h !== undefined) props.h = lerp(from.h, c.h);
        editor.updateShape({ id: sh.id, type: sh.type, x: lerp(from.x, c.x), y: lerp(from.y, c.y), props });
      });
      return;
    }
    case "highlight": {
      // Pulse a named shape while it is talked about.
      const id = names.get(c.name);
      const sh = id && editor.getShape(id);
      if (!sh) return;
      await animate(c.ms ?? 900, (p) => editor.updateShape({ id: sh.id, type: sh.type, opacity: 1 - 0.7 * Math.abs(Math.sin(p * Math.PI * 2)) }));
      editor.updateShape({ id: sh.id, type: sh.type, opacity: 1 });
      return;
    }
    case "option": {
      // One side of a trade-off: a box with its pros (+) and cons (−) under it, in a spot with room for both.
      const at = freeSpot(editor, c.x, c.y, GRID.w, GRID.h + 130);
      await run(editor, { op: "geo", geo: "rectangle", name: c.name, x: at.x, y: at.y, w: GRID.w, h: GRID.h, text: c.label, color: c.color ?? "blue", fill: "semi", size: "s", ms: 300 });
      const lines = [...(c.pros ?? []).slice(0, 2).map((t) => [`+ ${t}`, "green"] as const), ...(c.cons ?? []).slice(0, 2).map((t) => [`− ${t}`, "red"] as const)];
      const notes: TLShapeId[] = [];
      for (const [i, [text, color]] of lines.entries()) {
        const note = `${c.name}#${i}`;
        await run(editor, { op: "text", name: note, x: at.x + 6, y: at.y + GRID.h + 14 + i * 30, text, color, size: "s", font: "draw", ms: text.length * 25 });
        notes.push(names.get(note)!);
        names.delete(note); // notes belong to their option; only the option is addressed by name
      }
      optionNotes.set(c.name, notes);
      weighing.add(c.name);
      return;
    }
    case "pick": {
      // The decision: the chosen option turns green with a tick; the alternatives it was weighed against fade back.
      const id = names.get(c.name);
      const sh = id && editor.getShape(id);
      if (!sh) return;
      const rivals = weighing.has(c.name) ? [...weighing].filter((n) => n !== c.name) : [];
      const fade = rivals.flatMap((n) => [names.get(n), ...(optionNotes.get(n) ?? [])]).filter((x): x is TLShapeId => !!x && !!editor.getShape(x));
      const p0 = sh.props as any;
      const label = p0.richText ? renderPlaintextFromRichText(editor, p0.richText) : "";
      editor.updateShape({ id: sh.id, type: sh.type, props: { color: "green", ...(sh.type === "geo" && !label.startsWith("✓") ? { richText: toRichText(`✓ ${label}`) } : {}) } } as any);
      await animate(c.ms ?? 600, (p) => editor.updateShapes(fade.map((f) => ({ id: f, type: editor.getShape(f)!.type, opacity: 1 - 0.7 * ease(p) }))));
      rivalsOf.set(c.name, rivals);
      weighing.clear();
      return;
    }
    case "focus": {
      const id = names.get(c.name);
      const b = id && editor.getShapePageBounds(id);
      if (!b) return;
      editor.zoomToBounds(b, { inset: 160, targetZoom: 1.5, animation: { duration: c.ms ?? 600 } });
      return sleep(c.ms ?? 600);
    }
    case "bounds":
      editor.zoomToBounds({ x: c.x, y: c.y, w: c.w, h: c.h }, { inset: 48, animation: { duration: c.ms ?? 500 } });
      return sleep(c.ms ?? 0);
    case "audio": {
      // Narration in sync with the timeline. Browsers may block autoplay until the page is clicked.
      audio?.pause();
      audio = new Audio(c.src);
      const startedAt = performance.now();
      audio.play().catch(() => {
        setStatus("click the canvas to hear the narration");
        window.addEventListener("pointerdown", () => {
          if (!audio) return;
          audio.currentTime = (performance.now() - startedAt) / 1000;
          audio.play();
        }, { once: true });
      });
      return;
    }
    case "move": {
      // Move every shape with this tag together (e.g. a rocket lifting off).
      const ids = tags.get(c.tag) ?? [];
      const starts = ids.map((id) => { const sh = editor.getShape(id)!; return { id, type: sh.type, x: sh.x, y: sh.y }; });
      const curve = c.ease === "in" ? (p: number) => p * p * p : ease;
      await animate(c.ms ?? 1000, (p) => {
        const e = curve(p);
        editor.updateShapes(starts.map((s) => ({ id: s.id, type: s.type, x: s.x + c.dx * e, y: s.y + c.dy * e })));
      });
      return;
    }
    case "wait":
      return sleep(c.ms);
    case "status":
      setStatus(c.text);
      return;
    case "fit":
      editor.zoomToFit({ animation: { duration: c.ms ?? 600 } });
      return sleep(c.ms ?? 600);
    case "camera": {
      const vp = editor.getViewportScreenBounds();
      const zoom = c.zoom ?? editor.getZoomLevel();
      editor.setCamera({ x: -c.x + vp.w / 2 / zoom, y: -c.y + vp.h / 2 / zoom, z: zoom }, { animation: { duration: c.ms ?? 600 } });
      return sleep(c.ms ?? 600);
    }
    case "stroke": {
      // Freehand stroke drawn point by point: the shape's points grow every frame.
      const [ox, oy] = c.points[0];
      const pts = c.points.map(([x, y]) => ({ x: x - ox, y: y - oy, z: 0.5 }));
      const id: TLShapeId = createShapeId();
      const props = (n: number) => ({
        segments: compressLegacySegments([{ type: "free", points: pts.slice(0, Math.max(2, n)) }]),
        isComplete: n >= pts.length,
        isClosed: !!c.closed && n >= pts.length,
      });
      remember(c, id);
      editor.createShape({
        id, type: "draw", x: ox, y: oy,
        props: { color: c.color ?? "black", size: c.size ?? "m", dash: c.dash ?? "draw", fill: c.fill ?? "none", ...props(2) },
      });
      let last = 2;
      await animate(c.ms ?? Math.min(1500, pts.length * 12), (p) => {
        const n = Math.ceil(ease(p) * pts.length);
        if (n !== last) { last = n; editor.updateShape({ id, type: "draw", props: props(n) }); }
      });
      return;
    }
    case "text": {
      // Text that types itself on.
      const id = createShapeId();
      remember(c, id);
      editor.createShape({ id, type: "text", x: c.x, y: c.y, props: { richText: toRichText(""), color: c.color ?? "black", size: c.size ?? "m", font: c.font ?? "draw" } });
      let shown = -1;
      await animate(c.ms ?? c.text.length * 45, (p) => {
        const n = Math.round(p * c.text.length);
        if (n !== shown) { shown = n; editor.updateShape({ id, type: "text", props: { richText: toRichText(c.text.slice(0, n) || " ") } }); }
      });
      return;
    }
    case "geo": {
      // Shapes fade and settle in.
      const id = createShapeId();
      remember(c, id);
      editor.createShape({
        id, type: "geo", x: c.x, y: c.y, opacity: 0,
        props: { geo: c.geo as any, w: c.w, h: c.h, color: c.color ?? "black", fill: c.fill ?? "none", dash: c.dash ?? "draw", size: c.size ?? "m", font: c.font ?? "draw", richText: toRichText(c.text ?? "") },
      });
      await animate(c.ms ?? 400, (p) => editor.updateShape({ id, type: "geo", opacity: ease(p) }));
      return;
    }
    case "frame": {
      // A labelled region that groups part of a diagram (drawn behind what comes after it).
      const id = createShapeId();
      remember(c, id);
      editor.createShape({ id, type: "frame", x: c.x, y: c.y, opacity: 0, props: { w: c.w, h: c.h, name: c.label, color: c.color ?? "black" } });
      await animate(c.ms ?? 400, (p) => editor.updateShape({ id, type: "frame", opacity: ease(p) }));
      return;
    }
    case "arrow": {
      // Arrows grow from start to end. Ends given as shape names start/stop at the box edges and are
      // then bound to the boxes, so the arrows stay attached if someone moves the boxes later.
      const fromId = typeof c.from === "string" ? names.get(c.from) : undefined;
      const toId = typeof c.to === "string" ? names.get(c.to) : undefined;
      if ((typeof c.from === "string" && !fromId) || (typeof c.to === "string" && !toId)) throw new Error(`arrow: unknown shape name ${c.from} or ${c.to}`);
      const toC: Pt = toId ? centerOf(editor, toId) : (c.to as Pt);
      const fromC: Pt = fromId ? centerOf(editor, fromId) : (c.from as Pt);
      const anchorPt = (id: TLShapeId, an: { x: number; y: number }): Pt => { const bb = editor.getShapePageBounds(id)!; return [bb.x + bb.w * an.x, bb.y + bb.h * an.y]; };
      const a: Pt = fromId ? (c.fromAnchor ? anchorPt(fromId, c.fromAnchor) : edgePoint(editor, fromId, toC)) : fromC;
      const b: Pt = toId ? (c.toAnchor ? anchorPt(toId, c.toAnchor) : edgePoint(editor, toId, fromC)) : toC;
      const id = createShapeId();
      remember({ ...c, name: (c as any).name ?? (fromId && toId ? `${c.from}->${c.to}` : undefined) }, id);
      const [fx, fy] = a, dx = b[0] - fx, dy = b[1] - fy;
      editor.createShape({
        id, type: "arrow", x: fx, y: fy,
        props: { start: { x: 0, y: 0 }, end: { x: 0.1, y: 0.1 }, bend: 0, color: c.color ?? "black", size: c.size ?? "m", dash: c.dash ?? "draw", richText: toRichText("") },
      });
      await animate(c.ms ?? 700, (p) => {
        const e = ease(p);
        editor.updateShape({ id, type: "arrow", props: { end: { x: dx * e || 0.1, y: dy * e || 0.1 }, bend: (c.bend ?? 0) * e } });
      });
      const bind = (terminal: "start" | "end", toShape: TLShapeId, anchor?: { x: number; y: number }) =>
        ({ type: "arrow" as const, fromId: id, toId: toShape, props: { terminal, normalizedAnchor: anchor ?? { x: 0.5, y: 0.5 }, isExact: false, isPrecise: !!anchor, snap: "none" as const } });
      const bindings = [fromId && bind("start", fromId, c.fromAnchor), toId && bind("end", toId, c.toAnchor)].filter(Boolean) as any[];
      if (bindings.length) editor.createBindings(bindings);
      if (c.text) editor.updateShape({ id, type: "arrow", props: { richText: toRichText(c.text) } });
      return;
    }
  }
}

/**
 * What's on the board, for the model, in the grid terms it draws with (so new things go in empty cells): the pages,
 * everything on the current one, and the boxes on the others.
 */
function describeCanvas(editor: Editor): string {
  const nameOf = new Map([...names].map(([n, id]) => [id, n]));
  const at = (x: number, y: number) => `[${Math.round(x / GRID.col)},${Math.round(y / GRID.row)}]`;
  const label = (p: any) => JSON.stringify(p.richText ? renderPlaintextFromRichText(editor, p.richText) : p.name ?? "");
  const current = editor.getCurrentPageId();
  const pages = editor.getPages();
  const lines: string[] = [];
  if (pages.length > 1 || pages[0].name !== "Page 1") lines.push(`pages: ${pages.map((p) => (p.id === current ? `"${p.name}" (current)` : `"${p.name}"`)).join(", ")}`);
  for (const id of editor.getCurrentPageShapeIds()) {
    const sh = editor.getShape(id), b = editor.getShapePageBounds(id);
    if (!sh || !b) continue;
    const p = sh.props as any, name = nameOf.get(id);
    if (sh.type === "geo") lines.push(`box ${name ?? "(unnamed)"} ${label(p)} at ${at(b.x, b.y)} ${p.color}${p.geo === "rectangle" ? "" : ` ${p.geo}`}`);
    else if (sh.type === "arrow") lines.push(`arrow ${name ?? "(unnamed)"} ${label(p)}`);
    else if (sh.type === "frame") lines.push(`group ${name ?? "(unnamed)"} ${label(p)} from ${at(b.x + 40, b.y + 50)} to ${at(b.maxX - 40 - GRID.w, b.maxY - 50 - GRID.h)}`);
    else if (name?.startsWith("title")) lines.push(`title ${label(p)}`);
    else if (sh.type === "text") lines.push(`note ${label(p)} at ${at(b.x, b.y - 25)}`);
    else lines.push(`${sh.type} at ${at(b.x, b.y)}`);
  }
  for (const page of pages.filter((p) => p.id !== current)) {
    const boxes = [...editor.getPageShapeIds(page.id)].map((id) => editor.getShape(id)!).filter((sh) => sh.type === "geo")
      .map((sh) => `${nameOf.get(sh.id) ?? "(unnamed)"} ${label(sh.props)}`);
    lines.push(`on page "${page.name}" (not current): ${boxes.join(", ") || "nothing yet"}`);
  }
  return lines.join("\n");
}

/** Whether a shape is on the page being shown (arrows can't join pages; pointing at another page shows nothing). */
const onCurrentPage = (editor: Editor, id: TLShapeId | undefined) => !!id && !!editor.getShape(id) && editor.getAncestorPageId(id) === editor.getCurrentPageId();

/** ?ui=off hides tldraw's toolbars and menus (demo recordings): just the drawing and the talk panel. */
const SHOW_UI = new URLSearchParams(location.search).get("ui") !== "off";
/** Screen space the talk panel and toolbars cover, so the drawing is kept clear of them. */
const COVERED = SHOW_UI ? { left: 390, top: 70, right: 170, bottom: 90 } : { left: 390, top: 70, right: 20, bottom: 20 };

/** Keep the drawing in the uncovered part of the screen as it grows, without zooming in past 100%. */
function keepInView(editor: Editor, ms = 500) {
  const all = editor.getCurrentPageBounds();
  if (!all) return;
  const s = editor.getViewportScreenBounds(), z = editor.getZoomLevel(), cam = editor.getCamera(), m = 40;
  const toPage = (x: number, y: number) => ({ x: x / z - cam.x, y: y / z - cam.y });
  const a = toPage(COVERED.left + m, COVERED.top + m), b = toPage(s.w - COVERED.right - m, s.h - COVERED.bottom - m);
  if (all.minX >= a.x && all.minY >= a.y && all.maxX <= b.x && all.maxY <= b.y) return;
  const fw = s.w - COVERED.left - COVERED.right - 2 * m, fh = s.h - COVERED.top - COVERED.bottom - 2 * m;
  const nz = Math.max(0.1, Math.min(1, fw / all.w, fh / all.h));
  const cx = COVERED.left + m + fw / 2, cy = COVERED.top + m + fh / 2;
  editor.setCamera({ x: cx / nz - all.midX, y: cy / nz - all.midY, z: nz }, ms ? { animation: { duration: ms } } : undefined);
}

/**
 * Where a new box (or note) can go without covering anything: its own grid cell if that's free, otherwise the
 * nearest free cell, preferring right and down. The model doesn't always keep track of which cells are taken.
 */
function freeSpot(editor: Editor, x: number, y: number, w: number, h: number) {
  const titles = new Set([...names].filter(([n]) => n.startsWith("title")).map(([, id]) => id));
  const taken = [...editor.getCurrentPageShapeIds()]
    .map((id) => editor.getShape(id)!)
    .filter((sh) => sh.type === "geo" || (sh.type === "text" && !titles.has(sh.id)))
    .map((sh) => editor.getShapePageBounds(sh.id)!);
  const m = 20;
  const free = (px: number, py: number) => !taken.some((b) => px < b.maxX + m && px + w > b.minX - m && py < b.maxY + m && py + h > b.minY - m);
  if (free(x, y)) return { x, y };
  const tries: [number, number][] = [];
  for (let dr = 0; dr <= 4; dr++) for (let dc = -3; dc <= 5; dc++) tries.push([dc, dr]);
  tries.sort((a, b) => Math.abs(a[0]) + a[1] - (Math.abs(b[0]) + b[1]) || b[0] - a[0]);
  for (const [dc, dr] of tries) {
    const px = x + dc * GRID.col, py = y + dr * GRID.row;
    if (px >= 0 && free(px, py)) return { x: px, y: py };
  }
  return { x, y };
}

/** Whether the straight line from a to b crosses a box (other than the ones it connects). */
function crossesBox(editor: Editor, a: Pt, b: Pt, skip: TLShapeId[]) {
  const boxes = [...editor.getCurrentPageShapeIds()].filter((id) => !skip.includes(id) && editor.getShape(id)!.type === "geo").map((id) => editor.getShapePageBounds(id)!);
  for (let i = 1; i < 20; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / 20, y = a[1] + ((b[1] - a[1]) * i) / 20;
    if (boxes.some((r) => x > r.minX - 8 && x < r.maxX + 8 && y > r.minY - 8 && y < r.maxY + 8)) return true;
  }
  return false;
}
let bends = 0;

let editorRef: Editor | null = null;
/** Run a command from the conversation: draw it, then keep the whole drawing on screen. */
async function talkRun(c: Cmd) {
  if (!editorRef) return;
  setStatus("");
  // A new title replaces the old one.
  if (c.op === "text" && c.name === "title" && names.has("title")) { editorRef.deleteShapes([names.get("title")!]); names.delete("title"); }
  // Arrows only join shapes on this page; highlighting something on another page would show nothing.
  const editor = editorRef;
  if (c.op === "arrow" && [c.from, c.to].some((n) => typeof n === "string" && !onCurrentPage(editor, names.get(n)))) return;
  if (c.op === "highlight" && !onCurrentPage(editor, names.get(c.name))) return;
  // A box that's already there is pointed at, not drawn twice.
  const existing = (c.op === "geo" || c.op === "option") && c.name ? names.get(c.name) : undefined;
  if ((c.op === "geo" || c.op === "option") && existing && editorRef.getShape(existing)) c = { op: "highlight", name: c.name! };
  else if (c.op === "geo") c = { ...c, ...freeSpot(editorRef, c.x, c.y, c.w, c.h) };
  else if (c.op === "text" && c.name !== "title") c = { ...c, ...freeSpot(editorRef, c.x, c.y, GRID.w, 40) };
  else if (c.op === "arrow" && !c.bend && typeof c.from === "string" && typeof c.to === "string") {
    // An arrow that would run through another box curves around it instead (alternating sides).
    const a = names.get(c.from), b = names.get(c.to);
    if (a && b && editorRef.getShape(a) && editorRef.getShape(b)) {
      const pa = centerOf(editorRef, a), pb = centerOf(editorRef, b);
      if (crossesBox(editorRef, pa, pb, [a, b])) c = { ...c, bend: (bends++ % 2 ? 1 : -1) * Math.min(160, 50 + Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * 0.12) };
    }
  }
  await run(editorRef, c);
  if (["geo", "text", "frame", "arrow", "stroke", "option", "page"].includes(c.op)) keepInView(editorRef);
}

/** Tabs for the board's pages, once there's more than the default one: which topic you're on, and a way back. */
let pagesChanged = () => {};
function PageTabs() {
  const [, redraw] = useState(0);
  useEffect(() => { pagesChanged = () => redraw((n) => n + 1); }, []);
  const editor = editorRef;
  const pages = editor?.getPages() ?? [];
  if (!editor || (pages.length === 1 && pages[0].name === "Page 1")) return null;
  const current = editor.getCurrentPageId();
  return (
    <div style={{ position: "fixed", top: 16, left: COVERED.left, right: COVERED.right, display: "flex", justifyContent: "center", gap: 8, zIndex: 1000, font: "14px system-ui, sans-serif" }}>
      {pages.map((p) => (
        <button key={p.id} onClick={() => editor.setCurrentPage(p.id)}
          style={{ padding: "7px 14px", borderRadius: 999, cursor: "pointer", border: "1px solid", font: "inherit", transition: "all 200ms",
            ...(p.id === current ? { background: "#1d1d1f", color: "#fff", borderColor: "#1d1d1f" } : { background: "#fff", color: "#555", borderColor: "#ddd" }) }}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

let setStatus: (t: string) => void = () => {};
let audio: HTMLAudioElement | null = null;

function start(editor: Editor) {
  (window as any).editor = editor;
  editorRef = editor;
  editor.user.updateUserPreferences({ colorScheme: "light" });
  // Redraw the page tabs when pages are added or renamed, or another page is shown.
  let pagesSeen = "";
  editor.store.listen(() => {
    const now = editor.getCurrentPageId() + editor.getPages().map((p) => p.id + p.name).join();
    if (now !== pagesSeen) { pagesSeen = now; pagesChanged(); }
  });
  const queue: Cmd[] = [];
  let busy = false;
  const pump = async () => {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const c = queue.shift()!;
      try { await run(editor, c); } catch (e) { console.error("command failed", c, e); }
    }
    busy = false;
  };
  const es = new EventSource("/api/events");
  // Batches whose commands carry `at` (seconds) run on a clock, concurrently, like the video timeline.
  // Commands without `at` run one after another.
  let timers: number[] = [];
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    const cmds: (Cmd & { at?: number })[] = Array.isArray(data) ? data : [data];
    if (cmds.some((c) => c.at !== undefined)) {
      if (cmds.some((c) => c.op === "clear")) { timers.forEach(clearTimeout); timers = []; queue.length = 0; audio?.pause(); }
      const t0 = performance.now();
      const ends = cmds.map((c) => (c.at ?? 0) * 1000 + ((c as any).ms ?? 0));
      const total = Math.max(0, ...ends);
      setStatus("drawing on the timeline…");
      for (const c of cmds) {
        const delay = (c.at ?? 0) * 1000;
        const go = () => run(editor, c).catch((e) => console.error("command failed", c, e));
        if (delay <= 0) go();
        else timers.push(window.setTimeout(go, Math.max(0, delay - (performance.now() - t0))));
      }
      timers.push(window.setTimeout(() => setStatus("done"), total + 50));
    } else {
      queue.push(...cmds);
      pump();
    }
  };
  es.onopen = () => setStatus("connected — waiting for Claude to draw…");
}

function App() {
  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Tldraw onMount={start} hideUi={!SHOW_UI} />
      <PageTabs />
      <Talk run={talkRun} describe={() => (editorRef ? describeCanvas(editorRef) : "")} />
      <div
        ref={(el) => { if (el) setStatus = (t) => { el.textContent = t; el.style.display = t && SHOW_UI ? "" : "none"; }; }}
        style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 64, zIndex: 1000, font: "14px system-ui", background: "#111c", color: "#fff", padding: "6px 12px", borderRadius: 8, pointerEvents: "none" }}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
