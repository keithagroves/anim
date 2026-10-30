import { createServer } from "node:http";
import { clipFile } from "./clips.js";
import { createReadStream, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { loadVideo } from "./load.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONTS: Record<string, string> = {
  "inter.woff2": join(ROOT, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"),
  "mono.woff2": join(ROOT, "node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2"),
};

const FONT_CSS = `
@font-face { font-family: "Inter Variable"; src: url(/fonts/inter.woff2) format("woff2"); font-weight: 100 900; }
@font-face { font-family: "JetBrains Mono Variable"; src: url(/fonts/mono.woff2) format("woff2"); font-weight: 100 800; }`;

const RENDER_HTML = (w: number, h: number) => `<!doctype html><html><head><meta charset="utf-8"><style>${FONT_CSS}
html,body{margin:0;background:#000}#stage{width:${w}px;height:${h}px;overflow:hidden}</style>
<link rel="preload" href="/fonts/inter.woff2" as="font" crossorigin><link rel="preload" href="/fonts/mono.woff2" as="font" crossorigin></head>
<body><div id="stage"></div>
<div style="position:absolute;opacity:0;font-family:'Inter Variable'">a<b>b</b><span style="font-family:'JetBrains Mono Variable'">c</span></div>
<script src="/render.js"></script></body></html>`;

const PLAYER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>anim preview</title><style>${FONT_CSS}
*{box-sizing:border-box}body{margin:0;background:#05070d;color:#cfd6ee;font:14px/1.4 "Inter Variable",system-ui,sans-serif;display:flex;flex-direction:column;height:100vh}
#wrap{position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:16px 16px 0}
#stage{position:relative;width:100%;max-height:100%;aspect-ratio:16/9;max-width:calc((100vh - 260px) * 16 / 9);box-shadow:0 10px 40px #0008}
#caption{text-align:center;min-height:24px;color:#8b95b9;padding:6px 16px 0;font-size:15px}
#bar{padding:8px 16px 0;display:flex;gap:12px;align-items:center}
button{background:#1c2544;color:#e9edf9;border:1px solid #2d3a63;border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer;min-width:72px}
#scrub{flex:1;accent-color:#4f8cff}#time{font-family:"JetBrains Mono Variable",monospace;font-size:12px;min-width:300px;text-align:right}
#marks{position:relative;height:26px;margin:6px 16px 0}
.mark{position:absolute;top:0;height:22px;border:1px solid #2d3a63;background:#141b31;border-radius:5px;font-size:11px;padding:3px 6px;overflow:hidden;cursor:pointer;white-space:nowrap}
.mark:hover{background:#1c2544}
#pin{position:absolute;border:3px solid #ffcf7a;box-shadow:0 0 0 3px #0009;pointer-events:none;display:none}
.mark.missing{border-style:dashed;color:#6b7596;background:transparent}.mark.bad{border-color:#ff5d6c;color:#ff8a95}
.mark.warned{border-color:#a8873f}.mark.clean{border-color:#2f8f66}
#lint{height:110px;overflow:auto;margin:8px 16px 12px;padding:8px 10px;background:#0b1020;border:1px solid #1c2544;border-radius:8px;font:12px/1.5 "JetBrains Mono Variable",monospace}
.err{color:#ff8a95}.warn{color:#ffcf7a}.ok{color:#5fe3a8}
</style></head><body>
<div id="wrap"><div id="stage"></div></div>
<div id="caption"></div>
<div id="bar"><button id="play">Play</button><input id="scrub" type="range" min="0" max="1" step="0.001" value="0"><span id="time"></span></div>
<div id="marks"></div>
<div id="lint"></div>
<script src="/player.js"></script></body></html>`;

async function bundle(entry: string): Promise<string> {
  const r = await esbuild.build({ entryPoints: [join(ROOT, entry)], bundle: true, write: false, format: "iife", target: "es2022", logLevel: "silent" });
  return r.outputFiles[0].text;
}

/** Newest mtime under the video dir — the player polls this to live-reload. */
function version(dir: string): string {
  let max = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "build" || e.name === "out" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else max = Math.max(max, statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return String(Math.round(max));
}

export type ExtraRoute = (req: IncomingMessage, res: ServerResponse, url: URL) => boolean | Promise<boolean>;

export async function startServer(defaultVideo: string, port = 0, extra?: ExtraRoute) {
  const [renderJs, playerJs] = await Promise.all([bundle("src/browser/render.ts"), bundle("src/browser/player.ts")]);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    // ?dir=<path relative to the repo> serves another video folder (used by the labelling UI).
    const dirParam = url.searchParams.get("dir");
    const videoDir = dirParam ? resolve(ROOT, dirParam) : defaultVideo;
    if (dirParam && !videoDir.startsWith(ROOT + sep)) { res.writeHead(403).end("dir outside repo"); return; }
    const send = (type: string, body: string) => { res.writeHead(200, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
    try {
      if (extra && (await extra(req, res, url))) return;
      if (url.pathname === "/") return send("text/html", PLAYER_HTML);
      if (url.pathname === "/render") {
        const v = loadVideo(videoDir);
        const [w, h] = v.project?.size ?? [1920, 1080];
        return send("text/html", RENDER_HTML(w, h));
      }
      if (url.pathname === "/render.js") return send("text/javascript", renderJs);
      if (url.pathname === "/player.js") return send("text/javascript", playerJs);
      if (url.pathname === "/api/version") return send("text/plain", version(videoDir));
      if (url.pathname === "/api/video") {
        const v = loadVideo(videoDir);
        return send("application/json", JSON.stringify({
          version: version(videoDir),
          errors: v.errors,
          scenes: v.scenes.map((s) => ({ id: s.id, scene: s.scene, errors: s.errors, issues: s.issues })),
        }));
      }
      const font = url.pathname.match(/^\/fonts\/(.+)$/);
      if (font && FONTS[font[1]]) {
        res.writeHead(200, { "content-type": "font/woff2" });
        return void createReadStream(FONTS[font[1]]).pipe(res);
      }
      const clip = clipFile(url.pathname);
      if (clip) {
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "max-age=3600" });
        return void createReadStream(clip).pipe(res);
      }
      const media = url.pathname.match(/^\/media\/([\w-]+)\/(vo|mix)\.wav$/);
      if (media) {
        const p = join(videoDir, "scenes", media[1], `${media[2]}.wav`);
        if (existsSync(p)) {
          const size = statSync(p).size;
          const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
          if (range) {
            const start = Number(range[1]), end = range[2] ? Number(range[2]) : size - 1;
            res.writeHead(206, { "content-type": "audio/wav", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
            return void createReadStream(p, { start, end }).pipe(res);
          }
          res.writeHead(200, { "content-type": "audio/wav", "accept-ranges": "bytes", "content-length": size });
          return void createReadStream(p).pipe(res);
        }
      }
      res.writeHead(404).end("not found");
    } catch (e: any) {
      res.writeHead(500).end(String(e?.stack ?? e));
    }
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return { url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
