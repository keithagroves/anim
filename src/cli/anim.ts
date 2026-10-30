#!/usr/bin/env -S npx tsx
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCmd } from "./score.js";
import { newCmd, renderFingerprint, typesCmd, videosCmd } from "./vtypes.js";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Page } from "playwright";
import { loadVideo, type LoadedVideo } from "./load.js";
import { startServer } from "./server.js";
import { renderSheet } from "./frames.js";
import { renderPlan } from "./plan.js";
import { evalCli } from "./eval.js";
import { commandHelp, isCommand, missingArg, topHelp, unknownCommand, version } from "./help.js";
import { setupCmd } from "./setup.js";
import { canvasCmd } from "../canvas/cli.js";
import { detectEdits, recordExport } from "../evals/traces.js";
import type { CScene } from "../engine/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function run(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean } = {}): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? res(out) : rej(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`))));
  });
}

function report(v: LoadedVideo, json: boolean): number {
  if (json) {
    console.log(JSON.stringify({ errors: v.errors, scenes: v.scenes.map((s) => ({ id: s.id, errors: s.errors, issues: s.issues })) }, null, 1));
  } else {
    for (const e of v.errors) console.log(`✖ ${e}`);
    for (const s of v.scenes) {
      const dur = s.scene ? ` (${s.scene.duration.toFixed(2)}s, ${s.scene.spans.map((x) => `${x.id} ${x.start.toFixed(2)}–${x.end.toFixed(2)}`).join(", ")})` : "";
      console.log(`\n${s.id}${dur}`);
      for (const e of s.errors) console.log(`  ✖ ${e}`);
      for (const i of s.issues) console.log(`  ${i.level === "error" ? "✖" : "▲"} [${i.rule}] ${i.where}: ${i.message}`);
      if (!s.errors.length && !s.issues.length) console.log("  ✓ clean");
    }
  }
  return v.errors.length + v.scenes.reduce((a, s) => a + s.errors.length + s.issues.filter((i) => i.level === "error").length, 0);
}

function sceneOrDie(v: LoadedVideo, id: string | undefined): { idx: number; scene: CScene } {
  const idx = id ? v.scenes.findIndex((s) => s.id === id) : 0;
  const s = v.scenes[idx];
  if (!s) throw new Error(`unknown scene "${id}" (have: ${v.scenes.map((s) => s.id).join(", ")})`);
  if (!s.scene || s.errors.length) throw new Error(`scene "${s.id}" does not compile:\n  ${s.errors.join("\n  ")}`);
  return { idx, scene: s.scene };
}

async function openPage(browser: Browser, url: string, v: LoadedVideo, viewport: { width: number; height: number }): Promise<Page> {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(`${url}/render`);
  await page.evaluate((scenes) => (window as any).anim.load(scenes), v.scenes.map((s) => s.scene));
  await page.evaluate(() => (window as any).anim.ready());
  return page;
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, videoArg, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    const topic = cmd ? argv[1] : undefined;
    if (!topic) { console.log(topHelp()); return; }
    console.log(commandHelp(topic) ?? unknownCommand("anim", topic));
    return;
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") { console.log(version()); return; }
  if (!isCommand(cmd)) unknownCommand("anim", cmd);
  if (argv.includes("--help") || argv.includes("-h")) { console.log(commandHelp(cmd)); return; }
  if (cmd === "setup") { setupCmd(); return; }
  if (cmd === "eval" || cmd === "gen" || cmd === "monitor") { await evalCli(cmd, argv.slice(1)); return; }
  if (cmd === "types") { typesCmd(); return; }
  if (cmd === "videos") { videosCmd(argv.slice(1)); return; }
  if (cmd === "new") { newCmd(argv.slice(1)); return; }
  if (!videoArg || videoArg.startsWith("-")) missingArg(cmd, "the <video> folder");
  const { values: o } = parseArgs({
    args: rest,
    options: {
      scene: { type: "string" }, section: { type: "string" }, times: { type: "string" }, every: { type: "string" },
      t: { type: "string" }, out: { type: "string" }, workers: { type: "string" }, port: { type: "string" }, json: { type: "boolean" },
      instant: { type: "boolean" }, speed: { type: "string" }, watch: { type: "boolean" }, url: { type: "string" },
      levels: { type: "boolean" }, backdrops: { type: "boolean" },
    },
  });
  const video = resolve(videoArg);

  if (cmd === "score") { scoreCmd(video, { scene: o.scene, levels: o.levels }); return; }

  if (cmd === "voice") {
    const v = loadVideo(video);
    if (!v.project) { report(v, false); process.exit(1); }
    const targets = v.project.scenes.filter((id) => !o.scene || id === o.scene);
    await Promise.all(targets.map(async (id) => {
      const sdir = join(video, "scenes", id);
      if (!existsSync(join(sdir, "narration.txt"))) { console.log(`${id}: no narration.txt, skipped`); return; }
      const vc = v.project!.voice;
      const out = vc.engine === "chatterbox"
        // Chatterbox runs in its own venv (its torch pins clash with Kokoro's); CHATTERBOX_PYTHON overrides it.
        ? await run(process.env.CHATTERBOX_PYTHON ?? join(homedir(), ".cache/narrated-walkthrough/chatterbox-venv/bin/python"), [
            join(ROOT, "vo/chatterbox_voice.py"), join(sdir, "narration.txt"), "--out", sdir,
            ...(vc.ref ? ["--ref", resolve(ROOT, vc.ref)] : []),
            "--exaggeration", String(vc.exaggeration), "--cfg-weight", String(vc.cfgWeight), "--seed", String(vc.seed)])
        : await run("uv", ["run", "--project", join(ROOT, "vo"), "--quiet", "python", join(ROOT, "vo/voice.py"),
            join(sdir, "narration.txt"), "--out", sdir, "--voice", vc.voice, "--speed", String(vc.speed)]);
      console.log(`${id}: ${out.trim().split("\n").pop()}`);
    }));
    return;
  }

  if (cmd === "canvas") {
    await canvasCmd(video, { scene: o.scene, instant: o.instant, speed: o.speed ? Number(o.speed) : undefined, watch: o.watch, url: o.url });
    return;
  }

  const v = loadVideo(video);

  if (cmd === "lint") {
    const edits = detectEdits(video);
    if (edits && !o.json) console.log(`(recorded ${edits} human edit(s) on generated sections)`);
    process.exit(report(v, !!o.json) ? 1 : 0);
  }

  if (cmd === "timing") {
    const { scene: c } = sceneOrDie(v, o.scene);
    console.log(`scene ${c.id}: ${c.duration.toFixed(2)}s`);
    console.log(`cues: ${Object.entries(c.cues).map(([k, t]) => `${k}@${t.toFixed(2)}`).join("  ") || "(none)"}`);
    c.spans.forEach((s, k) => {
      const said = c.words.filter((w) => w.start >= s.start && w.start < s.end).map((w) => w.text).join(" ").replace(/ ([.,!?;:])/g, "$1");
      console.log(`\n${s.id}  ${s.start.toFixed(2)}–${s.end.toFixed(2)}s  (${(s.end - s.start).toFixed(2)}s)  ${s.brief}`);
      console.log(`  narration: "${said}"`);
      for (const a of c.anims[k]) console.log(`  ${a.start.toFixed(2)}–${(a.start + a.dur).toFixed(2)}  ${a.preset.padEnd(10)} ${a.target}`);
    });
    if (c.through.length) console.log(`\nthrough: ${c.through.map((a) => `${a.preset}→${a.target} ${a.start.toFixed(2)}–${(a.start + a.dur).toFixed(2)}`).join(", ")}`);
    return;
  }

  if (cmd === "preview") {
    const srv = await startServer(video, Number(o.port ?? 5173));
    console.log(`preview: ${srv.url}  (live-reloads when files in ${videoArg} change)`);
    return; // keep serving
  }

  if (cmd === "plan") {
    const r = await renderPlan(video, o.scene, o.out);
    for (const p of r.problems) console.log(`  ▲ ${p}`);
    console.log(r.path);
    return;
  }

  if (cmd === "sheet") {
    console.log(await renderSheet(video, o.scene, {
      section: o.section, out: o.out, backdrops: o.backdrops,
      every: o.every ? Number(o.every) : undefined,
      times: o.times ? o.times.split(",").map(Number) : undefined,
    }));
    return;
  }

  if (cmd === "frame") {
    const { idx, scene: c } = sceneOrDie(v, o.scene);
    const srv = await startServer(video);
    const browser = await chromium.launch();
    try {
      const [W, H] = c.size;
      const t = Number(o.t ?? 0);
      const page = await openPage(browser, srv.url, v, { width: W, height: H });
      await page.evaluate(([i, tt]) => (window as any).anim.seek(i, tt), [idx, t]);
      const out = o.out ?? join(video, "build", c.id, `frame-${t.toFixed(2)}.png`);
      mkdirSync(dirname(out), { recursive: true });
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
      console.log(out);
      return;
    } finally {
      await browser.close();
      await srv.close();
    }
  }

  if (cmd === "render") {
    if (report(v, false)) throw new Error("fix errors before rendering");
    const project = v.project!;
    const fps = project.fps;
    const [W, H] = project.size;
    const build = join(video, "build", "render");
    rmSync(build, { recursive: true, force: true });
    mkdirSync(build, { recursive: true });

    // One job per section: sections render in parallel, then concatenate.
    const jobs: { scene: number; from: number; to: number; file: string }[] = [];
    v.scenes.forEach((s, i) => {
      const c = s.scene!;
      const totalFrames = Math.round(c.duration * fps);
      c.spans.forEach((sp, k) => {
        const from = Math.round(sp.start * fps), to = k === c.spans.length - 1 ? totalFrames : Math.round(sp.end * fps);
        if (to > from) jobs.push({ scene: i, from, to, file: join(build, `${String(jobs.length).padStart(3, "0")}-${c.id}-${sp.id}.mp4`) });
      });
    });
    const workers = Math.max(1, Number(o.workers ?? Math.min(jobs.length, Math.max(2, Math.floor(cpus().length / 2)))));
    const srv = await startServer(video);
    const browser = await chromium.launch();
    const started = Date.now();
    let done = 0;
    const totalFrames = jobs.reduce((a, j) => a + j.to - j.from, 0);
    try {
      const queue = [...jobs];
      await Promise.all(Array.from({ length: workers }, async () => {
        const page = await openPage(browser, srv.url, v, { width: W, height: H });
        // Chrome's fast PNG mode: still lossless, but 3–4× quicker than page.screenshot's default
        // compression, which dominated render time (smooth gradients compress slowly).
        const cdp = await page.context().newCDPSession(page);
        const shot = async () => {
          const r = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } } as any);
          return Buffer.from(r.data, "base64");
        };
        for (let job = queue.shift(); job; job = queue.shift()) {
          const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
            "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(fps), job.file], { stdio: ["pipe", "inherit", "inherit"] });
          const closed = new Promise<void>((res, rej) => ff.on("close", (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))));
          for (let f = job.from; f < job.to; f++) {
            await page.evaluate(([i, t]) => (window as any).anim.seek(i, t), [job.scene, f / fps]);
            const png = await shot();
            if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
            done++;
            if (done % 60 === 0) process.stdout.write(`\r  frames ${done}/${totalFrames}`);
          }
          ff.stdin.end();
          await closed;
        }
        await page.close();
      }));
    } finally {
      await browser.close();
      await srv.close();
    }
    console.log(`\r  frames ${totalFrames}/${totalFrames} in ${((Date.now() - started) / 1000).toFixed(1)}s with ${workers} workers`);

    const list = join(build, "segments.txt");
    writeFileSync(list, jobs.map((j) => `file '${j.file}'`).join("\n"));
    const silent = join(build, "video.mp4");
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent]);

    // Audio: each scene's narration padded/trimmed to the scene's duration, then joined.
    const audioIn: string[] = [], filters: string[] = [];
    v.scenes.forEach((s, i) => {
      const d = s.scene!.duration.toFixed(3);
      if (s.audioPath) audioIn.push("-i", s.audioPath);
      else audioIn.push("-f", "lavfi", "-t", d, "-i", "anullsrc=r=24000:cl=mono");
      filters.push(`[${i}:a]aresample=48000,apad,atrim=0:${d}[a${i}]`);
    });
    const audio = join(build, "audio.wav");
    await run("ffmpeg", ["-y", "-loglevel", "error", ...audioIn, "-filter_complex",
      `${filters.join(";")};${v.scenes.map((_, i) => `[a${i}]`).join("")}concat=n=${v.scenes.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5[out]`, "-map", "[out]", "-ar", "48000", audio]);

    const out = resolve(o.out ?? join(video, "out", "video.mp4"));
    mkdirSync(dirname(out), { recursive: true });
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", audio, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);

    // Captions from the word timestamps.
    let offset = 0;
    const cues: string[] = ["WEBVTT", ""];
    const ts = (t: number) => new Date(t * 1000).toISOString().slice(11, 23);
    for (const s of v.scenes) {
      const words = s.scene!.words;
      let line: typeof words = [];
      const flush = () => {
        if (!line.length) return;
        cues.push(`${ts(offset + line[0].start)} --> ${ts(offset + line[line.length - 1].end)}`, line.map((w) => w.text).join(" ").replace(/ ([.,!?;:])/g, "$1"), "");
        line = [];
      };
      for (const w of words) { line.push(w); if (/[.!?]/.test(w.text) || line.filter((x) => /\w/.test(x.text)).length >= 8) flush(); }
      flush();
      offset += s.scene!.duration;
    }
    writeFileSync(out.replace(/\.mp4$/, ".vtt"), cues.join("\n"));
    recordExport(video);
    writeFileSync(join(dirname(out), "render.json"), JSON.stringify({ renderedAt: new Date().toISOString(), out: basename(out), fingerprint: renderFingerprint(v) }, null, 2));
    console.log(out);
    return;
  }

  unknownCommand("anim", cmd);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
