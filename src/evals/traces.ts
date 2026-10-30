import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadVideo } from "../cli/load.js";
import { parseJudge, runJudge, type JudgeResult } from "./judge.js";
import { sectionMetrics, type SectionMetrics } from "./metrics.js";
import { runSut, type SutSpec } from "./sut.js";
import { copyVideo, EVALS, isDir, newId, outputId, readJson, ROOT, TRACES, writeJson } from "./util.js";
import { addCaseFromDir } from "./promote.js";

export type TraceEvent =
  | { type: "human-edit"; ts: string; from: string | null; to: string | null }
  | { type: "export"; ts: string; outputId: string | null; edited: boolean }
  | { type: "regenerate"; ts: string; by: string }
  | { type: "seam-fail"; ts: string; messages: string[] }
  | { type: "judge"; ts: string; result: JudgeResult };

export interface Trace {
  id: string;
  ts: string;
  kind: "section-gen";
  video: string;
  scene: string;
  section: string;
  sut: string;
  outputId: string | null;
  gen: { ok: boolean; costUsd: number; durationMs: number; turns: number; friction: string[]; error?: string };
  metrics: SectionMetrics;
  features: { cues: number; spanSeconds: number; sharedObjects: number; briefWords: number };
  judge?: JudgeResult;
  events: TraceEvent[];
}

export const traceDir = (id: string) => join(TRACES, id);
export const loadTrace = (id: string): Trace => readJson(join(traceDir(id), "trace.json"));
export const saveTrace = (t: Trace) => writeJson(join(traceDir(t.id), "trace.json"), t);
export function listTraces(): Trace[] {
  if (!isDir(TRACES)) return [];
  return readdirSync(TRACES).filter((d) => existsSync(join(TRACES, d, "trace.json"))).sort().map(loadTrace);
}

const sectionFile = (video: string, scene: string, section: string) => join(video, "scenes", scene, "sections", `${section}.json`);

/** Input features used to detect drift between live usage and the gold set. */
export function inputFeatures(video: string, scene: string, section: string): Trace["features"] {
  const s = loadVideo(video).scenes.find((x) => x.id === scene)?.scene;
  const sp = s?.spans.find((x) => x.id === section);
  if (!s || !sp) return { cues: 0, spanSeconds: 0, sharedObjects: 0, briefWords: 0 };
  return {
    cues: Object.values(s.cues).filter((t) => t >= sp.start && t < sp.end).length,
    spanSeconds: Math.round((sp.end - sp.start) * 100) / 100,
    sharedObjects: Object.values(s.objects).filter((o) => o.owner === "scene").length,
    briefWords: sp.brief.split(/\s+/).length,
  };
}

function latestTraceFor(video: string, scene: string, section: string): Trace | undefined {
  const rel = relative(ROOT, resolve(video));
  return listTraces().filter((t) => t.video === rel && t.scene === scene && t.section === section).pop();
}

export interface GenOpts { sut: SutSpec; budgetUsd: number; judge?: string; judgeSample: number }

/** Production entry point: generate a section in a real video and record a trace. */
export async function genSection(videoArg: string, scene: string, section: string, o: GenOpts, log = console.log): Promise<Trace> {
  const video = resolve(videoArg);
  const id = newId("tr-");
  const dir = traceDir(id);
  mkdirSync(dir, { recursive: true });
  // Freeze the inputs exactly as a gold case would be (so the trace can be promoted later).
  copyVideo(video, join(dir, "input"), { dropSections: true });
  const prev = latestTraceFor(video, scene, section);

  // Generate in an isolated copy so parallel generations can't see (or be blamed for) each other's
  // files; only the target section is copied back into the real video.
  const work = join(dir, "work");
  copyVideo(video, work);
  log(`generating ${scene}/${section} in ${relative(ROOT, video)} …`);
  const g = await runSut(o.sut, work, scene, section, o.budgetUsd);
  const metrics = sectionMetrics(work, scene, section, g.scopeViolations);
  const produced = sectionFile(work, scene, section);
  if (existsSync(produced)) {
    mkdirSync(join(dir, "output"), { recursive: true });
    cpSync(produced, join(dir, "output", `${section}.json`));
    cpSync(produced, sectionFile(video, scene, section));
  }
  rmSync(work, { recursive: true, force: true });
  const trace: Trace = {
    id, ts: new Date().toISOString(), kind: "section-gen", video: relative(ROOT, video), scene, section, sut: g.sut, outputId: g.outputId,
    gen: { ok: g.ok, costUsd: g.costUsd, durationMs: g.durationMs, turns: g.turns, friction: g.friction, error: g.error },
    metrics, features: inputFeatures(video, scene, section), events: [],
  };
  if (o.judge && metrics.exists && Math.random() < o.judgeSample) {
    try { trace.judge = await runJudge(parseJudge(o.judge), video, scene, section, 0.5); }
    catch (e: any) { log(`  judge failed: ${e.message}`); }
  }
  saveTrace(trace);
  if (prev) { prev.events.push({ type: "regenerate", ts: trace.ts, by: id }); saveTrace(prev); }
  log(`  trace ${id}: gate ${metrics.gate ? "PASS" : "FAIL"} · errors ${metrics.errors} · $${g.costUsd.toFixed(2)} · ${(g.durationMs / 1000).toFixed(0)}s`);
  if (g.friction.length) log(`  friction:\n${g.friction.map((f) => "    - " + f).join("\n")}`);
  return trace;
}

/** Record human edits since generation (call from lint/render). */
export function detectEdits(videoArg: string): number {
  const video = resolve(videoArg);
  const rel = relative(ROOT, video);
  let n = 0;
  const latest = new Map<string, Trace>();
  for (const t of listTraces()) if (t.video === rel) latest.set(`${t.scene}/${t.section}`, t);
  for (const t of latest.values()) {
    const now = outputId(sectionFile(video, t.scene, t.section));
    const lastKnown = [...t.events].reverse().find((e) => e.type === "human-edit") as Extract<TraceEvent, { type: "human-edit" }> | undefined;
    const current = lastKnown ? lastKnown.to : t.outputId;
    if (now !== current) { t.events.push({ type: "human-edit", ts: new Date().toISOString(), from: current, to: now }); saveTrace(t); n++; }
  }
  return n;
}

/** Record that the current sections shipped in a render (the acceptance signal), plus any integration seam failures. */
export function recordExport(videoArg: string) {
  const video = resolve(videoArg);
  detectEdits(video);
  const rel = relative(ROOT, video);
  const v = loadVideo(video);
  const latest = new Map<string, Trace>();
  for (const t of listTraces()) if (t.video === rel) latest.set(`${t.scene}/${t.section}`, t);
  for (const t of latest.values()) {
    const now = outputId(sectionFile(video, t.scene, t.section));
    const seams = v.scenes.find((s) => s.id === t.scene)?.issues.filter((i) => i.rule === "seam" && i.section === t.section) ?? [];
    if (seams.length) t.events.push({ type: "seam-fail", ts: new Date().toISOString(), messages: seams.map((s) => s.message) });
    t.events.push({ type: "export", ts: new Date().toISOString(), outputId: now, edited: now !== t.outputId });
    saveTrace(t);
  }
}

/** Freeze a trace's inputs as a new gold case: every understood production failure becomes a regression test. */
export function promoteTrace(id: string, opts: { caseId?: string; tags?: string[]; notes?: string } = {}) {
  const t = loadTrace(id);
  const caseId = opts.caseId ?? `trace-${id.replace(/^tr-/, "")}-${t.section}`;
  return addCaseFromDir(join(traceDir(id), "input"), join(EVALS, "cases", caseId), {
    id: caseId, scene: t.scene, section: t.section, tags: ["from-trace", ...(opts.tags ?? [])], source: `trace:${id}`, notes: opts.notes,
  });
}
