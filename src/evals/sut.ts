import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { SceneFile } from "../engine/types.js";
import { runClaude } from "./runners.js";
import { changedFiles, EVALS, outputId, ROOT, sha, snapshotFiles } from "./util.js";

export interface SutSpec { runner: "claude-code"; model?: string; effort?: string }

export interface SutResult {
  sut: string;
  promptHash: string;
  outputId: string | null;
  ok: boolean;
  costUsd: number;
  durationMs: number;
  turns: number;
  report: string;
  friction: string[];
  scopeViolations: string[];
  error?: string;
}

export function sutPrompt(video: string, scene: string, section: string): { text: string; hash: string } {
  const raw = readFileSync(join(EVALS, "prompts", "section-agent.md"), "utf8");
  const sceneFile = SceneFile.parse(JSON.parse(readFileSync(join(video, "scenes", scene, "scene.json"), "utf8")));
  const brief = sceneFile.sections.find((s) => s.id === section)?.brief ?? "";
  const rel = relative(ROOT, video);
  const vars: Record<string, string> = { video: rel, scene, section, file: `${rel}/scenes/${scene}/sections/${section}.json`, brief };
  return { text: raw.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ""), hash: sha(raw) };
}

export const sutId = (s: SutSpec, promptHash: string) => `${s.runner}${s.model ? ":" + s.model : ""}${s.effort ? "/" + s.effort : ""}@${promptHash}`;

export function parseFriction(report: string): string[] {
  const m = report.match(/##\s*Friction\s*\n([\s\S]*?)(\n##\s|$)/i);
  if (!m) return [];
  return m[1].split("\n").map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter((l) => l && !/^none\.?$/i.test(l));
}

/** Generate one section with the SUT inside `video`, and check that only the section file changed. */
export async function runSut(spec: SutSpec, video: string, scene: string, section: string, budgetUsd: number): Promise<SutResult> {
  const prompt = sutPrompt(video, scene, section);
  const target = join("scenes", scene, "sections", `${section}.json`);
  const before = snapshotFiles(video);
  const r = await runClaude({
    prompt: prompt.text,
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash(npm run anim:*)", "Bash(npx tsx src/cli/anim.ts:*)"],
    model: spec.model, effort: spec.effort, budgetUsd,
  });
  const after = snapshotFiles(video);
  const scopeViolations = changedFiles(before, after).filter((f) => f !== target);
  return {
    sut: sutId(spec, prompt.hash), promptHash: prompt.hash,
    outputId: outputId(join(video, target)),
    ok: r.ok, costUsd: r.costUsd, durationMs: r.durationMs, turns: r.turns,
    report: r.text, friction: parseFriction(r.text), scopeViolations, error: r.error,
  };
}
