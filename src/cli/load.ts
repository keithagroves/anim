import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ZodType } from "zod";
import { compileScene } from "../engine/compile.js";
import { prepareClips } from "./clips.js";
import { lint, type Issue } from "../engine/lint.js";
import { DEFAULT_THEME, mergeTheme } from "../engine/theme.js";
import { resolveBackdrop } from "../engine/backdrop.js";
import { ProjectFile, SceneFile, SectionFile, type CScene, type Words } from "../engine/types.js";

export interface LoadedScene {
  id: string;
  dir: string;
  scene: CScene | null;
  errors: string[];
  issues: Issue[];
  hasNarration: boolean;
  audioPath?: string;
}

export interface LoadedVideo {
  dir: string;
  project: ProjectFile | null;
  scenes: LoadedScene[];
  errors: string[];
}

function readJson<T>(path: string, schema: ZodType<T, any, any>, root: string, errors: string[]): T | null {
  const rel = relative(root, path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e: any) {
    errors.push(`${rel}: ${e.message}`);
    return null;
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    for (const i of r.error.issues) errors.push(`${rel}: ${i.path.join(".") || "(root)"}: ${i.message}`);
    return null;
  }
  return r.data;
}

export function loadVideo(dir: string): LoadedVideo {
  const errors: string[] = [];
  const project = readJson(join(dir, "project.json"), ProjectFile, dir, errors);
  if (!project) return { dir, project, scenes: [], errors };
  let themeOver: any;
  if (existsSync(join(dir, "theme.json"))) {
    try { themeOver = JSON.parse(readFileSync(join(dir, "theme.json"), "utf8")); }
    catch (e: any) { errors.push(`theme.json: ${e.message}`); }
  }
  const theme = mergeTheme(DEFAULT_THEME, themeOver);
  resolveBackdrop(theme.backdrop, errors);

  const scenes = project.scenes.map((id, index): LoadedScene => {
    const sdir = join(dir, "scenes", id);
    const errs: string[] = [];
    const sceneFile = readJson(join(sdir, "scene.json"), SceneFile, dir, errs);
    const hasNarration = existsSync(join(sdir, "narration.txt"));
    if (!sceneFile) return { id, dir: sdir, scene: null, errors: errs, issues: [], hasNarration };
    const sections = sceneFile.sections.map((s) => {
      const p = join(sdir, "sections", `${s.id}.json`);
      return existsSync(p) ? readJson(p, SectionFile, dir, errs) : null;
    });
    let words: Words | undefined;
    const wp = join(sdir, "vo.words.json");
    if (existsSync(wp)) words = JSON.parse(readFileSync(wp, "utf8"));
    // mix.wav (narration + score) wins while it's at least as new as everything it was made from.
    const mtime = (f: string) => (existsSync(join(sdir, f)) ? statSync(join(sdir, f)).mtimeMs : -1);
    const mixFresh = mtime("mix.wav") >= 0 && mtime("mix.wav") >= Math.max(mtime("vo.wav"), mtime("score.json"));
    const audioFile = mixFresh ? "mix.wav" : existsSync(join(sdir, "vo.wav")) ? "vo.wav" : undefined;
    const audioPath = audioFile ? join(sdir, audioFile) : undefined;
    const srcs = [sceneFile.objects, ...sections.map((s) => s?.objects ?? {})]
      .flatMap((objs) => Object.values(objs)).filter((o) => o.type === "video" && o.src).map((o) => o.src!);
    const clips = srcs.length ? prepareClips(dir, srcs, project.fps, errs) : undefined;
    const { scene, errors: cerrs } = compileScene({
      project, theme, scene: sceneFile, sections, words, clips,
      audio: audioFile ? `/media/${id}/${audioFile}` : undefined,
    });
    errs.push(...cerrs);
    // Lint even when some section fails to compile, so other sections still get feedback.
    let issues: Issue[] = [];
    try { issues = lint(scene, { index, count: project.scenes.length }); } catch (e: any) { errs.push(`lint crashed: ${e.message}`); }
    return { id, dir: sdir, scene, errors: errs, issues, hasNarration, audioPath };
  });
  return { dir, project, scenes, errors };
}
