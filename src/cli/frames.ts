import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { loadVideo } from "./load.js";
import { startServer } from "./server.js";
import { BACKDROP_PRESETS } from "../engine/backdrop.js";

export interface SheetOpts {
  section?: string; every?: number; times?: number[]; out?: string; cellW?: number;
  /** One cell per backdrop preset, all at the same time (the first of `times`, else the scene's midpoint). */
  backdrops?: boolean;
}

/** Render a contact sheet PNG of a scene (or one section) and return its path. */
export async function renderSheet(video: string, sceneId: string | undefined, opts: SheetOpts = {}): Promise<string> {
  const v = loadVideo(video);
  const idx = sceneId ? v.scenes.findIndex((s) => s.id === sceneId) : 0;
  const s = v.scenes[idx];
  if (!s) throw new Error(`unknown scene "${sceneId}" (have: ${v.scenes.map((x) => x.id).join(", ")})`);
  if (!s.scene) throw new Error(`scene "${s.id}" does not compile:\n  ${s.errors.join("\n  ")}`);
  const c = s.scene;

  let range = { start: 0, end: c.duration };
  let k = -1;
  if (opts.section) {
    k = c.spans.findIndex((x) => x.id === opts.section);
    if (k < 0) throw new Error(`unknown section "${opts.section}"`);
    range = c.spans[k];
  }
  let times: number[];
  if (opts.times) times = opts.times;
  else if (opts.every) { times = []; for (let t = range.start; t < range.end - 1e-6; t += opts.every) times.push(t); times.push(range.end - 0.01); }
  else {
    // Keyframes: section start, every animation end (settled poses), just before the section end.
    const anims = k >= 0 ? c.anims[k] : c.anims.flat();
    const set = new Set<number>([range.start, ...anims.map((a) => Math.min(a.start + a.dur, range.end)), range.end - 0.01].map((t) => Math.round(t * 20) / 20));
    times = [...set].filter((t) => t >= range.start && t <= range.end).sort((a, b) => a - b);
    while (times.length > 24) times = times.filter((_, i) => i % 2 === 0 || i === times.length - 1);
  }
  const cellW = opts.cellW ?? 480;
  let cols = Math.min(4, times.length);
  let scenes = v.scenes.map((x) => x.scene);
  let cells = times.map((t) => {
    const kk = c.spans.findIndex((x) => t < x.end);
    return { scene: idx, t, label: `${t.toFixed(2)}s · ${c.spans[kk < 0 ? c.spans.length - 1 : kk].id}` };
  });
  if (opts.backdrops) {
    // Same frame, re-themed once per preset.
    const t = opts.times?.[0] ?? c.duration / 2;
    const names = Object.keys(BACKDROP_PRESETS);
    scenes = names.map((b) => ({ ...c, theme: { ...c.theme, backdrop: b } }));
    cells = names.map((b, i) => ({ scene: i, t, label: `${b} · ${t.toFixed(2)}s` }));
    cols = 3;
  }

  const srv = await startServer(video);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: cols * cellW, height: 600 }, deviceScaleFactor: 1 });
    await page.goto(`${srv.url}/render`);
    await page.evaluate((sc) => (window as any).anim.load(sc), scenes);
    await page.evaluate(() => (window as any).anim.ready());
    const dims = await page.evaluate(([cl, co, w]) => (window as any).anim.sheet(cl, co, w), [cells, cols, cellW] as const);
    await page.setViewportSize({ width: Math.ceil(dims.width), height: Math.ceil(dims.height) });
    const out = opts.out ?? join(video, "build", c.id, `${opts.backdrops ? "backdrops" : opts.section ?? "scene"}-sheet.png`);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: true });
    return out;
  } finally {
    await browser.close();
    await srv.close();
  }
}
