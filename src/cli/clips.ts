// Video clips → numbered JPEG frames at the project fps, cached under <video>/build/clips/.
// Frames (not <video> seeking) keep rendering deterministic: frame n of the clip is always the same file.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ClipInfo } from "../engine/types.js";

export const REPO = resolve(import.meta.dirname, "../..");

export function prepareClips(videoDir: string, srcs: string[], fps: number, errors: string[]): Record<string, ClipInfo> {
  const out: Record<string, ClipInfo> = {};
  videoDir = resolve(videoDir);
  for (const src of new Set(srcs)) {
    const abs = resolve(videoDir, src);
    if (!existsSync(abs)) { errors.push(`clip not found: ${src}`); continue; }
    const dir = join(videoDir, "build", "clips", src.replace(/[^\w.-]+/g, "_"));
    const metaPath = join(dir, "meta.json");
    const stamp = `${statSync(abs).mtimeMs}:${statSync(abs).size}:${fps}`;
    let meta: Omit<ClipInfo, "url"> & { stamp?: string } | undefined;
    try { meta = JSON.parse(readFileSync(metaPath, "utf8")); } catch {}
    if (meta?.stamp !== stamp) {
      try {
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        execFileSync("ffmpeg", ["-v", "error", "-i", abs, "-vf", `fps=${fps},scale='min(1920,iw)':-2`, "-q:v", "3", join(dir, "%05d.jpg")]);
        const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", join(dir, "00001.jpg")], { encoding: "utf8" }).trim().split(",").map(Number);
        const frames = readdirSync(dir).filter((f) => f.endsWith(".jpg")).length;
        meta = { stamp, frames, fps, w, h, duration: frames / fps };
        writeFileSync(metaPath, JSON.stringify(meta));
      } catch (e: any) { errors.push(`clip ${src}: ffmpeg failed: ${String(e.stderr ?? e.message).slice(0, 300)}`); continue; }
    }
    const { stamp: _s, ...info } = meta!;
    out[src] = { ...info, url: `/clips/${encodeURIComponent(relative(REPO, dir))}` };
  }
  return out;
}

/** Serve /clips/<encoded dir relative to the repo>/<n>.jpg (only inside the repo). */
export function clipFile(pathname: string): string | null {
  const m = pathname.match(/^\/clips\/([^/]+)\/(\d+\.jpg)$/);
  if (!m) return null;
  const p = resolve(REPO, decodeURIComponent(m[1]), m[2]);
  return p.startsWith(REPO + "/") && existsSync(p) ? p : null;
}
