// Headless render surface: Playwright drives window.anim to paint exact frames.
import { evaluate } from "../engine/evaluate.js";
import { paint } from "../engine/paint.js";
import type { CScene } from "../engine/types.js";

let scenes: CScene[] = [];

/** Resolve once every <image> (video frames) in `root` has loaded, so screenshots never catch a blank frame. */
function settle(root: HTMLElement): Promise<void> {
  const imgs = [...root.querySelectorAll("image")] as SVGImageElement[];
  if (!imgs.length) return Promise.resolve();
  const loads = imgs.map((el) => new Promise<void>((r) => {
    el.addEventListener("load", () => r(), { once: true });
    el.addEventListener("error", () => r(), { once: true });
    setTimeout(r, 5000);
  }));
  return Promise.all(loads).then(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

(window as any).anim = {
  load(s: CScene[]) { scenes = s; },
  async ready() { await document.fonts.ready; return true; },
  seek(i: number, t: number) {
    const root = document.getElementById("stage")!;
    root.innerHTML = paint(scenes[i], evaluate(scenes[i], t), "f");
    return settle(root);
  },
  /** Contact sheet: a grid of small frames with time labels. */
  async sheet(cells: { scene: number; t: number; label: string }[], cols: number, cellW: number) {
    const [W, H] = scenes[0].size;
    const cellH = (cellW * H) / W;
    const root = document.getElementById("stage")!;
    root.style.width = `${cols * cellW}px`;
    root.style.height = "auto";
    root.innerHTML = `<div style="display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:0;background:#000">${cells
      .map((c, i) => `<div style="position:relative;width:${cellW}px;height:${cellH + 30}px">
        <div style="width:${cellW}px;height:${cellH}px">${paint(scenes[c.scene], evaluate(scenes[c.scene], c.t), `s${i}`)}</div>
        <div style="height:30px;font:600 16px 'JetBrains Mono Variable',monospace;color:#cfd6ee;background:#05070d;display:flex;align-items:center;padding:0 10px;border-right:1px solid #222">${c.label}</div>
      </div>`)
      .join("")}</div>`;
    await settle(root);
    return { width: cols * cellW, height: Math.ceil(cells.length / cols) * (cellH + 30) };
  },
};
