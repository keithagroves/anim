import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { loadVideo } from "./load.js";
import { SceneFile } from "../engine/types.js";
import { color } from "../engine/theme.js";
import { parseSketch, sketchBox, sketchMarkup, sketchRoles } from "../engine/sketch.js";

const ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
const FONT = (f: string) => pathToFileURL(join(ROOT, "node_modules/@fontsource-variable", f)).href;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The storyboard: one card per section (its sketch, time span, cues and brief), the look and the
 * palette roles on top: the picture of the film before any section is written.
 */
export async function renderPlan(video: string, sceneId: string | undefined, out?: string): Promise<{ path: string; problems: string[] }> {
  const v = loadVideo(video);
  const ls = sceneId ? v.scenes.find((s) => s.id === sceneId) : v.scenes[0];
  if (!ls) throw new Error(`unknown scene "${sceneId}" (have: ${v.scenes.map((x) => x.id).join(", ")})`);
  if (!ls.scene) throw new Error(`scene "${ls.id}" does not compile:\n  ${ls.errors.join("\n  ")}`);
  const c = ls.scene, theme = c.theme;
  const file = SceneFile.parse(JSON.parse(readFileSync(join(ls.dir, "scene.json"), "utf8")));
  const problems: string[] = [];

  const stylePath = join(video, "style.md");
  // style.md opens with "**Look: <name>.** <line>" (docs/looks.md).
  const lm = existsSync(stylePath) ? /\*\*Look:\s*([^*]+?)\.?\*\*\s*(.*)/.exec(readFileSync(stylePath, "utf8")) : null;
  const look = lm ? `${lm[1]}: ${lm[2]}` : "";
  const swatches = sketchRoles(theme).map((tok, i) =>
    `<div class="sw"><i style="background:${color(theme, tok, "#888")}"></i><b>$${i + 1}</b> ${esc(tok)}</div>`).join("");

  const cards = file.sections.map((sec, k) => {
    const span = c.spans[k];
    const cues = Object.entries(c.cues).filter(([, t]) => t >= span.start && t < span.end).map(([n]) => n);
    let pic = `<div class="none">no sketch</div>`;
    if (sec.sketch) {
      const { errors, paths } = parseSketch(sec.sketch);
      for (const e of errors) problems.push(`${sec.id}: ${e}`);
      if (paths.length < 8) problems.push(`${sec.id}: ${paths.length} paths (8–12 make a frame someone can judge)`);
      pic = `<svg viewBox="0 0 ${sketchBox(c.size).join(" ")}">${sketchMarkup(sec.sketch, theme, { rough: true, id: `pl-${sec.id}`, size: c.size })}</svg>`;
    } else problems.push(`${sec.id}: no sketch`);
    return `<div class="card"><div class="pic">${pic}</div>
      <div class="meta"><b>${esc(sec.id)}</b> ${span.start.toFixed(1)}–${span.end.toFixed(1)} s${span.placeholder ? "" : ` <span class="done">written</span>`}</div>
      <div class="brief">${esc(sec.brief)}</div>
      ${cues.length ? `<div class="cues">${cues.map((x) => `cue:${esc(x)}`).join(" · ")}</div>` : ""}</div>`;
  }).join("");

  const title = v.project?.title ?? c.id;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Inter Variable"; src: url(${FONT("inter/files/inter-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "JetBrains Mono Variable"; src: url(${FONT("jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2")}) format("woff2"); font-weight: 100 800; }
*{box-sizing:border-box} body{margin:0;padding:40px;width:1600px;background:#f4f2ec;color:#1d1f24;font:16px/1.45 "Inter Variable",sans-serif}
h1{font-size:34px;margin:0 0 4px} .look{color:#555;margin:0 0 16px;font-size:18px} .pal{display:flex;gap:18px;margin-bottom:28px;flex-wrap:wrap}
.sw{display:flex;align-items:center;gap:6px;font-size:14px;color:#444} .sw i{width:22px;height:22px;border-radius:5px;border:1px solid #0002}
.sw b{font-family:"JetBrains Mono Variable"}
.grid{display:grid;grid-template-columns:repeat(${c.size[1] > c.size[0] ? 5 : 3},1fr);gap:28px}
.card{background:#fff;border-radius:14px;padding:14px;box-shadow:0 2px 10px #0001}
.pic{aspect-ratio:${c.size[0]}/${c.size[1]};border-radius:8px;overflow:hidden;background:#e9e6de} .pic svg{width:100%;height:100%;display:block}
.none{height:100%;display:flex;align-items:center;justify-content:center;color:#999;border:2px dashed #ccc;border-radius:8px}
.meta{margin:10px 0 4px;font-family:"JetBrains Mono Variable";font-size:14px;color:#555} .meta b{color:#1d1f24}
.done{background:#2fd18b33;color:#127a4f;border-radius:4px;padding:1px 6px;font-size:12px}
.brief{font-size:15px;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.cues{margin-top:6px;font-family:"JetBrains Mono Variable";font-size:12px;color:#777}
</style></head><body><h1>${esc(title)} · ${esc(c.id)} · ${c.duration.toFixed(1)} s</h1>
${look ? `<p class="look">${esc(look)}</p>` : ""}<div class="pal">${swatches}</div><div class="grid">${cards}</div></body></html>`;

  const path = out ?? join(video, "build", c.id, "plan.png");
  mkdirSync(dirname(path), { recursive: true });
  const htmlPath = path.replace(/\.png$/, ".html");
  writeFileSync(htmlPath, html);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1680, height: 900 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.evaluate(() => (document as any).fonts.ready);
    await page.screenshot({ path, fullPage: true });
  } finally {
    await browser.close();
  }
  return { path, problems };
}
