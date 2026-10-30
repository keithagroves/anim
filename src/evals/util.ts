import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EVALS = join(ROOT, "evals");
export const TRACES = join(ROOT, "traces");
export const MONITOR = join(ROOT, "monitor");

export const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex").slice(0, 12);
export const newId = (prefix = "") => `${prefix}${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-")}-${randomBytes(2).toString("hex")}`;

/** Content hash of a section file, ignoring formatting, so labels attach to content. */
export function outputId(path: string): string | null {
  if (!existsSync(path)) return null;
  try { return sha(JSON.stringify(JSON.parse(readFileSync(path, "utf8")))); } catch { return sha(readFileSync(path)); }
}

export function readJsonl<T = any>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
export function appendJsonl(path: string, row: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n");
}
export function writeJson(path: string, v: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(v, null, 1));
}
export const readJson = <T = any>(path: string): T => JSON.parse(readFileSync(path, "utf8"));

const SKIP = new Set(["build", "out", "node_modules", ".DS_Store"]);

/** Copy a video folder, optionally dropping section files (to freeze case inputs). */
export function copyVideo(src: string, dst: string, opts: { dropSections?: boolean } = {}) {
  cpSync(src, dst, {
    recursive: true,
    filter: (p) => {
      const rel = relative(src, p);
      const parts = rel.split("/");
      if (parts.some((x) => SKIP.has(x))) return false;
      if (opts.dropSections && parts.includes("sections") && p.endsWith(".json")) return false;
      return true;
    },
  });
  // Keep empty sections/ folders so agents know where to write.
  const scenes = join(dst, "scenes");
  if (existsSync(scenes)) for (const s of readdirSync(scenes)) mkdirSync(join(scenes, s, "sections"), { recursive: true });
}

/** Map of relative path → content hash for every file under dir (excluding build artefacts). */
export function snapshotFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p)] = sha(readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

export function changedFiles(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => before[k] !== after[k]).sort();
}

export const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();

/** Run async tasks with a concurrency limit, preserving result order. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
