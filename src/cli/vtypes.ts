// Video types (video-types/<id>/): what a kind of video is for, how it's made, and a scaffold.
// `anim types` lists them, `anim new <type> <dir>` starts a video from one, and `anim videos`
// catalogs every video in videos/ by type, with its features, render freshness and eval coverage.
import { BACKDROP_PRESETS } from "../engine/backdrop.js";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createHash } from "node:crypto";
import { loadVideo, type LoadedVideo } from "./load.js";
import { REPO } from "./clips.js";
import { missingArg } from "./help.js";

const TYPES_DIR = join(REPO, "video-types");
const Uses = z.enum(["yes", "optional", "no"]);

export const VideoType = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  goodFor: z.array(z.string()),
  examples: z.array(z.string()),
  length: z.string(),
  sectionLength: z.string(),
  uses: z.object({ narration: Uses, sectionAgents: Uses, footage: Uses, canvas: Uses, score: Uses }).strict(),
  steps: z.array(z.string()),
  scaffold: z.object({
    theme: z.record(z.any()),
    narration: z.string(),
    objects: z.record(z.any()).optional(),
    sections: z.array(z.object({ id: z.string(), seconds: z.number(), brief: z.string() }).strict()).min(1),
  }).strict(),
}).strict();
export type VideoType = z.infer<typeof VideoType>;

export function listTypes(): VideoType[] {
  if (!existsSync(TYPES_DIR)) return [];
  return readdirSync(TYPES_DIR).filter((d) => existsSync(join(TYPES_DIR, d, "type.json"))).map((d) => loadType(d));
}

export function loadType(id: string): VideoType {
  const p = join(TYPES_DIR, id, "type.json");
  if (!existsSync(p)) throw new Error(`unknown video type "${id}" (types: ${readdirSync(TYPES_DIR).join(", ")})`);
  const r = VideoType.safeParse(JSON.parse(readFileSync(p, "utf8")));
  if (!r.success) throw new Error(`video-types/${id}/type.json: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return r.data;
}

const USES = (t: VideoType) => Object.entries(t.uses).filter(([, v]) => v !== "no").map(([k, v]) => (v === "optional" ? `${k}?` : k)).join(" · ");

export function typesCmd() {
  for (const t of listTypes()) {
    console.log(`${t.id.padEnd(14)} ${t.name}: ${t.summary}`);
    console.log(`${"".padEnd(14)} good for: ${t.goodFor.join("; ")}`);
    console.log(`${"".padEnd(14)} ${t.length}, sections ${t.sectionLength} · uses ${USES(t)}`);
    console.log(`${"".padEnd(14)} examples: ${t.examples.join(", ") || "none in this repo yet"} · guide: video-types/${t.id}/guide.md\n`);
  }
}

// ---------------------------------------------------------------- anim new

export function newCmd(args: string[]) {
  const { values: o, positionals } = parseArgs({ args, allowPositionals: true, options: { title: { type: "string" }, scene: { type: "string" }, backdrop: { type: "string" }, vertical: { type: "boolean" } } });
  const [typeId, dirArg] = positionals;
  if (!typeId || !dirArg) missingArg("new", `the <type> and <video> arguments (types: ${listTypes().map((t) => t.id).join(", ")})`);
  const t = loadType(typeId);
  const dir = resolve(dirArg);
  if (existsSync(join(dir, "project.json"))) throw new Error(`${relative(process.cwd(), dir)} already has a project.json`);
  const title = o.title ?? basename(dir).replace(/[-_]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const scene = o.scene ?? "01-main";
  const sdir = join(dir, "scenes", scene);
  mkdirSync(join(sdir, "sections"), { recursive: true });

  const json = (p: string, v: unknown) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n");
  json(join(dir, "project.json"), { title, type: t.id, fps: 30, size: o.vertical ? [1080, 1920] : [1920, 1080], voice: { voice: "af_heart", speed: 1.0 }, scenes: [scene] });
  if (o.backdrop && !BACKDROP_PRESETS[o.backdrop]) throw new Error(`unknown backdrop "${o.backdrop}" (have: ${Object.keys(BACKDROP_PRESETS).join(", ")})`);
  json(join(dir, "theme.json"), o.backdrop ? { ...t.scaffold.theme, backdrop: o.backdrop } : t.scaffold.theme);
  const fill = (s: string) => s.replace(/\{\{title\}\}/g, title).replace(/\{\{dir\}\}/g, relative(REPO, dir));
  writeFileSync(join(dir, "style.md"), fill(readFileSync(join(TYPES_DIR, t.id, "style.md"), "utf8")));
  writeFileSync(join(sdir, "narration.txt"), t.scaffold.narration + "\n");
  let at = 0;
  json(join(sdir, "scene.json"), {
    id: scene,
    objects: t.scaffold.objects ?? {},
    keys: {},
    sections: t.scaffold.sections.map((s) => ({ id: s.id, target: [at, (at += s.seconds)], brief: s.brief })),
  });
  // Type-specific extras (e.g. the product-tour recorder).
  for (const f of readdirSync(join(TYPES_DIR, t.id))) {
    if (["type.json", "guide.md", "style.md"].includes(f)) continue;
    const src = join(TYPES_DIR, t.id, f);
    if (statSync(src).isDirectory()) cpSync(src, join(dir, f), { recursive: true });
    else writeFileSync(join(dir, f), fill(readFileSync(src, "utf8")));
  }
  if (t.uses.footage !== "no") mkdirSync(join(dir, "clips"), { recursive: true });

  const rel = relative(process.cwd(), dir);
  console.log(`created ${rel} (${t.name})\n\nnext (from video-types/${t.id}/guide.md):`);
  t.steps.forEach((s, i) => console.log(`  ${i + 1}. ${s.replace(/<video>/g, rel)}`));
  console.log(`\nbackdrop: ${o.backdrop ?? (t.scaffold.theme as any).backdrop ?? "dots"} (theme.json). Compare looks with: anim sheet ${rel} --scene ${scene} --backdrops (docs/theme.md)`);
}

// ---------------------------------------------------------------- render fingerprint

/**
 * What a render depends on, hashed by part: the compiled scenes (layout, timing, words), the audio files,
 * the footage clips and the engine/renderer code. Metadata such as the title or type isn't included, so
 * editing it doesn't make a render stale.
 */
export function renderFingerprint(v: LoadedVideo): Record<"scenes" | "audio" | "clips" | "engine", string> {
  const h = (parts: (string | Buffer)[]) => { const x = createHash("sha1"); for (const p of parts) x.update(p); return x.digest("hex").slice(0, 12); };
  const code = ["engine", "browser"].flatMap((d) => readdirSync(join(REPO, "src", d)).filter((f) => f.endsWith(".ts")).sort().map((f) => readFileSync(join(REPO, "src", d, f))));
  const clipSrcs = [...new Set(v.scenes.flatMap((s) => Object.values(s.scene?.objects ?? {}).filter((o) => o.def.type === "video" && o.def.src).map((o) => resolve(v.dir, o.def.src!))))].sort();
  return {
    scenes: h([JSON.stringify(v.scenes.map((s) => s.scene))]),
    audio: h(v.scenes.flatMap((s) => (s.audioPath && existsSync(s.audioPath) ? [basename(s.audioPath), readFileSync(s.audioPath)] : ["-"]))),
    clips: h(clipSrcs.map((p) => (existsSync(p) ? `${p}:${statSync(p).size}:${statSync(p).mtimeMs}` : `${p}:missing`))),
    engine: h(code),
  };
}

// ---------------------------------------------------------------- anim videos

export interface CatalogRow {
  video: string; title: string; type: string; duration: number; scenes: number; sections: number;
  features: string[]; errors: number; warnings: number; render: "fresh" | "stale" | "none" | "untracked"; staleBecause: string[];
  traces: number; goldCases: number;
}

export function catalog(videosDir = join(REPO, "videos")): CatalogRow[] {
  const traces = existsSync(join(REPO, "traces"))
    ? readdirSync(join(REPO, "traces")).flatMap((d) => { try { return [JSON.parse(readFileSync(join(REPO, "traces", d, "trace.json"), "utf8")).video as string]; } catch { return []; } })
    : [];
  const cases = existsSync(join(REPO, "evals", "cases"))
    ? readdirSync(join(REPO, "evals", "cases")).flatMap((d) => { try { return [JSON.parse(readFileSync(join(REPO, "evals", "cases", d, "case.json"), "utf8")).source as string]; } catch { return []; } })
    : [];
  const rows: CatalogRow[] = [];
  for (const name of readdirSync(videosDir).sort()) {
    const dir = join(videosDir, name);
    if (!existsSync(join(dir, "project.json"))) continue;
    const v = loadVideo(dir);
    const rel = relative(REPO, dir);
    const shown = relative(process.cwd(), dir);
    const objs = v.scenes.flatMap((s) => Object.values(s.scene?.objects ?? {}));
    const has = (f: string) => v.scenes.some((s) => existsSync(join(s.dir, f)));
    const features = [
      has("vo.wav") && "narration",
      objs.some((o) => o.def.type === "video") && "footage",
      has("score.json") && "score",
      traces.includes(rel) && "agent-written",
    ].filter(Boolean) as string[];
    const out = join(dir, "out", "video.mp4"), man = join(dir, "out", "render.json");
    const fp = renderFingerprint(v);
    const was = existsSync(man) ? JSON.parse(readFileSync(man, "utf8")).fingerprint : null;
    const staleBecause = was ? (Object.keys(fp) as (keyof typeof fp)[]).filter((k) => fp[k] !== was[k]) : [];
    rows.push({
      video: shown, title: v.project?.title ?? name, type: v.project?.type ?? "—",
      duration: v.scenes.reduce((a, s) => a + (s.scene?.duration ?? 0), 0),
      scenes: v.scenes.length, sections: v.scenes.reduce((a, s) => a + (s.scene?.spans.length ?? 0), 0),
      features,
      errors: v.errors.length + v.scenes.reduce((a, s) => a + s.errors.length + s.issues.filter((i) => i.level === "error").length, 0),
      warnings: v.scenes.reduce((a, s) => a + s.issues.filter((i) => i.level === "warn").length, 0),
      render: !existsSync(out) ? "none" : !was ? "untracked" : staleBecause.length ? "stale" : "fresh",
      staleBecause,
      traces: traces.filter((t) => t === rel).length,
      goldCases: cases.filter((c) => c === `video:${rel}`).length,
    });
  }
  return rows;
}

export function videosCmd(args: string[]) {
  const json = args.includes("--json");
  const local = join(process.cwd(), "videos");
  const rows = catalog(existsSync(local) ? local : undefined);
  if (json) { console.log(JSON.stringify(rows, null, 2)); return; }
  const types = new Map(listTypes().map((t) => [t.id, t]));
  const groups = new Map<string, CatalogRow[]>();
  for (const r of rows) groups.set(r.type, [...(groups.get(r.type) ?? []), r]);
  for (const [type, rs] of [...groups].sort()) {
    const t = types.get(type);
    console.log(`\n${t ? `${t.name} (${type})` : type === "—" ? "untyped (add \"type\" to project.json)" : `${type} (not in video-types/)`}`);
    for (const r of rs) {
      const render = r.render === "fresh" ? "✓ rendered" : r.render === "stale" ? `▲ render stale (${r.staleBecause.join(", ")} changed)` : r.render === "untracked" ? "? rendered before tracking" : "· not rendered";
      const lint = r.errors ? `✖ ${r.errors} errors` : "✓ lint";
      const evals = r.traces || r.goldCases ? ` · ${r.traces} traces, ${r.goldCases} gold cases` : "";
      console.log(`  ${r.video.padEnd(28)} ${r.title}`);
      console.log(`  ${"".padEnd(28)} ${r.duration.toFixed(1)}s · ${r.scenes} scene${r.scenes > 1 ? "s" : ""}, ${r.sections} section${r.sections > 1 ? "s" : ""} · ${r.features.join(", ") || "silent"} · ${lint} · ${render}${evals}`);
    }
  }
  const unused = [...types.keys()].filter((id) => !groups.has(id));
  if (unused.length) console.log(`\nno videos yet: ${unused.join(", ")}`);
}
