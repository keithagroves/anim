// Records real footage of a web app with Playwright + the installed Chrome. One record() per shot.
// Usage: npx tsx {{dir}}/record.mts [baseUrl]
import { chromium, type BrowserContext, type Page } from "playwright";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = join(import.meta.dirname, "clips");
const marks: Record<string, Record<string, number>> = {};

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function record(name: string, opts: Parameters<typeof browser.newContext>[0], fn: (page: Page, mark: (k: string) => void) => Promise<void>) {
  const vp = opts!.viewport!;
  // The screencast is captured in CSS pixels whatever the deviceScaleFactor; a larger size only pads it with grey.
  const ctx: BrowserContext = await browser.newContext({ ...opts, recordVideo: { dir: OUT, size: { width: vp.width, height: vp.height } } });
  // Don't send analytics hits from recordings.
  // Hide the Next.js dev-mode badge without touching the app's config.
  await ctx.addInitScript(`addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = "nextjs-portal{display:none!important}"; document.head.appendChild(st); });`);
  await ctx.route(/google-analytics\.com|googletagmanager\.com|analytics\.google\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  const t0 = Date.now();
  marks[name] = {};
  const mark = (k: string) => { marks[name][k] = (Date.now() - t0) / 1000; console.log(`${name} ${k} @ ${marks[name][k].toFixed(2)}s`); };
  await fn(page, mark);
  mark("end");
  const video = page.video()!;
  await ctx.close();
  renameSync(await video.path(), join(OUT, `${name}.webm`));
}

/** Eased smooth scroll so the element whose text matches sits `offset` px from the top. */
// Plain-string script: tsx would inject a __name helper into a function passed to evaluate().
const GLIDE = `async ([text, ms, offset]) => {
  const el = [...document.querySelectorAll("h1,h2,h3,h4")].find((e) => e.textContent && e.textContent.includes(text));
  if (!el) throw new Error("no heading with " + text);
  const from = scrollY, to = el.getBoundingClientRect().top + scrollY - offset;
  const t0 = performance.now();
  await new Promise((done) => {
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      scrollTo(0, from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
}`;
async function glideTo(page: Page, text: string, ms: number, offset = 90) {
  await page.evaluate(`(${GLIDE})(${JSON.stringify([text, ms, offset])})`);
}
const hold = (page: Page, s: number) => page.waitForTimeout(s * 1000);

const desktop = { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 };
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// Each shot: load a page, act, and mark() the moments you'll cut to (clip seconds land in marks.json).
await record("home", desktop, async (page, mark) => {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  mark("loaded");
  await hold(page, 5);
  mark("scroll-1");
  await glideTo(page, "A heading further down the page", 2200);   // scrolls until that heading is near the top
  mark("section-1");
  await hold(page, 4);
});

// await record("mobile", phone, async (page, mark) => { ... });

await browser.close();
writeFileSync(join(OUT, "marks.json"), JSON.stringify(marks, null, 2));
