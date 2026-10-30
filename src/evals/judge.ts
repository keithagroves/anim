import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadVideo } from "../cli/load.js";
import { renderSheet } from "../cli/frames.js";
import { ollamaDecide, ollamaSystemOne, runClaude } from "./runners.js";
import { EVALS, readJson, sha } from "./util.js";

export interface Criterion { id: string; question: string; pass: string; fail: string }
export interface Rubric { version: number; criteria: Criterion[]; overall: Criterion }

export const loadRubric = (): Rubric => readJson(join(EVALS, "rubric.json"));
export const allCriteria = (r: Rubric) => [...r.criteria, r.overall];

/**
 * Where a critique points: a moment in the scene (seconds, the time under the frame) and optionally a
 * place on the frame as fractions 0..1 (a point, or a box's top-left corner plus its width and height).
 * A pin can jump the player to the exact spot.
 */
export interface Pin { at: number; x?: number; y?: number; w?: number; h?: number; note: string }

export interface Verdict {
  pass: boolean;
  /** Claude judge: what each problem points at (empty for a pass). */
  pins?: Pin[];
  /** Probability of pass, when the judge provides one. */
  p: number | null;
  critique?: string;
  /** Which stage decided (e.g. "local:gemma4:e4b", "claude"). */
  by: string;
  uncertain: boolean;
  /** Local judges: |p(pass) with A=pass − p(pass) with A=fail|. Large = answer-letter bias, not judgement. */
  orderGap?: number;
}

export interface JudgeResult {
  judge: string;
  rubricVersion: number;
  verdicts: Record<string, Verdict>;
  costUsd: number;
  durationMs: number;
  escalated: string[];
  sheet: string;
  error?: string;
}

export interface JudgeContext { video: string; scene: string; section: string; sheet: string; brief: string; narration: string; cues: string; style: string }

/** Everything a judge needs about one section: the contact sheet plus the words it should match. */
export async function judgeContext(video: string, scene: string, section: string): Promise<JudgeContext> {
  const v = loadVideo(video);
  const s = v.scenes.find((x) => x.id === scene);
  const c = s?.scene;
  if (!c) throw new Error(`scene ${scene} does not compile`);
  const k = c.spans.findIndex((x) => x.id === section);
  if (k < 0) throw new Error(`unknown section ${section}`);
  const sp = c.spans[k];
  const sheet = await renderSheet(video, scene, { section, every: 0.5, cellW: 400, out: join(video, "build", scene, `${section}-judge.png`) });
  const words = c.words.filter((w) => w.start >= sp.start && w.start < sp.end);
  const narration = words.map((w) => (/\w/.test(w.text) ? `[${w.start.toFixed(1)}] ${w.text}` : w.text)).join(" ");
  const cues = Object.entries(c.cues).filter(([, t]) => t >= sp.start && t < sp.end).map(([n, t]) => `${n}@${t.toFixed(2)}s`).join(", ") || "(none)";
  const stylePath = join(video, "style.md");
  const style = existsSync(stylePath) ? readFileSync(stylePath, "utf8").slice(0, 2000) : "(no style guide)";
  return { video, scene, section, sheet, brief: sp.brief, narration, cues, style };
}

function template(name: string, vars: Record<string, string>): { text: string; hash: string } {
  const raw = readFileSync(join(EVALS, "prompts", name), "utf8");
  const text = raw.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
  return { text, hash: sha(raw) };
}

// ---------------------------------------------------------------- local typed judge

export interface LocalJudgeOpts { model: string; band?: [number, number]; maxOrderGap?: number }

/**
 * Letter-logit decisions per criterion over the same image + context (the prefix is cached by Ollama).
 * Each question is asked with both letter orders and the probabilities averaged, which cancels
 * answer-letter bias; criteria whose two orders disagree are flagged uncertain.
 */
export async function localJudge(ctx: JudgeContext, rubric: Rubric, o: LocalJudgeOpts): Promise<JudgeResult> {
  const band = o.band ?? [0.25, 0.75];
  const verdicts: Record<string, Verdict> = {};
  const started = Date.now();
  let hash = "";
  for (const cr of allCriteria(rubric)) {
    const t = template("judge-local.md", { ...ctx, question: cr.question, pass_def: cr.pass, fail_def: cr.fail });
    hash = t.hash;
    const swapped = t.text.replace("A) pass\nB) fail", "A) fail\nB) pass");
    if (swapped === t.text) throw new Error("judge-local.md must contain the lines 'A) pass' and 'B) fail'");
    const d1 = await ollamaDecide(o.model, t.text, ["A", "B"], [ctx.sheet]);
    const d2 = await ollamaDecide(o.model, swapped, ["A", "B"], [ctx.sheet]);
    const p1 = d1.probs.A, p2 = d2.probs.B;
    const p = (p1 + p2) / 2, gap = Math.abs(p1 - p2);
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    verdicts[cr.id] = {
      pass: p >= 0.5, p: r3(p), orderGap: r3(gap), by: `local:${o.model}`,
      uncertain: (p > band[0] && p < band[1]) || gap > (o.maxOrderGap ?? 0.3),
    };
  }
  return {
    judge: `local:${o.model}@${hash}+swap`, rubricVersion: rubric.version, verdicts, costUsd: 0,
    durationMs: Date.now() - started, escalated: [], sheet: ctx.sheet,
  };
}

// ---------------------------------------------------------------- local decision-model judge

/** Decision models (clef-flash): every criterion as a typed yes/no question, decided jointly in one call. */
export async function decisionJudge(ctx: JudgeContext, rubric: Rubric, o: { model: string; band?: [number, number] }): Promise<JudgeResult> {
  const band = o.band ?? [0.25, 0.75];
  const t = template("judge-decision.md", { ...ctx });
  const questions = Object.fromEntries(allCriteria(rubric).map((c) => [c.id, { type: "noul" as const, instructions: `${c.question} Yes means: ${c.pass} No means: ${c.fail}` }]));
  const r = await ollamaSystemOne(o.model, t.text, questions, [ctx.sheet]);
  const verdicts: Record<string, Verdict> = {};
  for (const c of allCriteria(rubric)) {
    const p = r.answers[c.id];
    if (p === undefined) continue;
    verdicts[c.id] = { pass: p >= 0.5, p: Math.round(p * 1000) / 1000, by: `decision:${o.model}`, uncertain: p > band[0] && p < band[1] };
  }
  return { judge: `decision:${o.model}@${t.hash}`, rubricVersion: rubric.version, verdicts, costUsd: 0, durationMs: r.durationMs, escalated: [], sheet: ctx.sheet };
}

/** First (free) stage: a decision model ("decision:<model>") or a letter-logit chat model ("<model>"). */
function firstStage(ctx: JudgeContext, rubric: Rubric, local: string, band?: [number, number]) {
  return local.startsWith("decision:") ? decisionJudge(ctx, rubric, { model: local.slice(9), band }) : localJudge(ctx, rubric, { model: local, band });
}

// ---------------------------------------------------------------- Claude judge

export interface ClaudeJudgeOpts { model?: string; budgetUsd: number; only?: string[] }

const frac = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined);
/** Keep well-formed pins only, with fractions clamped to the frame. */
export function cleanPins(raw: unknown): Pin[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p) => p && typeof p.at === "number" && Number.isFinite(p.at)).slice(0, 3).map((p) => {
    const pin: Pin = { at: Math.round(p.at * 100) / 100, note: String(p.note ?? "") };
    for (const k of ["x", "y", "w", "h"] as const) { const v = frac(p[k]); if (v !== undefined) pin[k] = Math.round(v * 10000) / 10000; }
    return pin;
  });
}

export async function claudeJudge(ctx: JudgeContext, rubric: Rubric, o: ClaudeJudgeOpts): Promise<JudgeResult> {
  const criteria = allCriteria(rubric).filter((c) => !o.only || o.only.includes(c.id));
  const rubricText = criteria.map((c) => `- **${c.id}**: ${c.question}\n  - pass: ${c.pass}\n  - fail: ${c.fail}`).join("\n");
  const t = template("judge.md", { ...ctx, rubric: rubricText });
  const pinSchema = {
    type: "object", additionalProperties: false, required: ["at", "note"],
    properties: {
      at: { type: "number" }, note: { type: "string" },
      x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" },
    },
  };
  const verdictSchema = {
    type: "object", additionalProperties: false, required: ["critique", "verdict", "pins"],
    properties: { critique: { type: "string" }, verdict: { type: "string", enum: ["pass", "fail"] }, pins: { type: "array", items: pinSchema, maxItems: 3 } },
  };
  const schema = {
    type: "object", additionalProperties: false, required: criteria.map((c) => c.id),
    properties: Object.fromEntries(criteria.map((c) => [c.id, verdictSchema])),
  };
  const r = await runClaude({
    prompt: t.text,
    systemPrompt: "You are a strict, consistent reviewer of animated explainer videos. You look at the contact sheet image you are given (read it with the Read tool) and grade it against a rubric of binary criteria. Write the critique before deciding. Judge only what is visible.",
    tools: ["Read"], allowedTools: ["Read"], jsonSchema: schema, model: o.model, budgetUsd: o.budgetUsd,
  });
  const verdicts: Record<string, Verdict> = {};
  if (r.ok && r.structured) {
    for (const c of criteria) {
      const v = r.structured[c.id];
      if (v) verdicts[c.id] = { pass: v.verdict === "pass", p: null, critique: v.critique, pins: cleanPins(v.pins), by: `claude${o.model ? ":" + o.model : ""}`, uncertain: false };
    }
  }
  return {
    judge: `claude${o.model ? ":" + o.model : ""}@${t.hash}`, rubricVersion: rubric.version, verdicts, costUsd: r.costUsd,
    durationMs: r.durationMs, escalated: [], sheet: ctx.sheet, error: r.ok ? undefined : r.error,
  };
}

// ---------------------------------------------------------------- cascade

export interface CascadeOpts { local: string; escalate: boolean; claudeModel?: string; budgetUsd: number; band?: [number, number] }

/** Local typed judge first; only uncertain criteria escalate to Claude (when allowed). */
export async function cascadeJudge(ctx: JudgeContext, rubric: Rubric, o: CascadeOpts): Promise<JudgeResult> {
  const local = await firstStage(ctx, rubric, o.local, o.band);
  const uncertain = Object.entries(local.verdicts).filter(([, v]) => v.uncertain).map(([k]) => k);
  if (!o.escalate || !uncertain.length) return { ...local, judge: `cascade(${local.judge})` };
  const strong = await claudeJudge(ctx, rubric, { model: o.claudeModel, budgetUsd: o.budgetUsd, only: uncertain });
  return {
    judge: `cascade(${local.judge} → ${strong.judge})`, rubricVersion: rubric.version,
    verdicts: { ...local.verdicts, ...strong.verdicts }, costUsd: strong.costUsd,
    durationMs: local.durationMs + strong.durationMs, escalated: uncertain, sheet: ctx.sheet, error: strong.error,
  };
}

export type JudgeSpec = { kind: "local"; model: string } | { kind: "decision"; model: string } | { kind: "claude"; model?: string } | { kind: "cascade"; local: string; escalate: boolean; claudeModel?: string };

export function parseJudge(s: string): JudgeSpec {
  // "local:gemma4:e4b" | "claude" | "claude:opus" | "cascade:gemma4:e4b" | "cascade+claude:gemma4:e4b"
  if (s.startsWith("local:")) return { kind: "local", model: s.slice(6) };
  if (s.startsWith("decision:")) return { kind: "decision", model: s.slice(9) };
  if (s === "claude" || s.startsWith("claude:")) return { kind: "claude", model: s.slice(7) || undefined };
  if (s.startsWith("cascade+claude:")) return { kind: "cascade", local: s.slice(15), escalate: true };
  if (s.startsWith("cascade:")) return { kind: "cascade", local: s.slice(8), escalate: false };
  throw new Error(`unknown judge "${s}" (local:<model> | decision:<model> | claude[:model] | cascade:<stage> | cascade+claude:<stage>, where <stage> is <model> or decision:<model>)`);
}

/** The id a judge spec will produce (minus any escalation suffix), including prompt-version hashes. */
export function judgeIdPrefix(spec: JudgeSpec): string {
  const h = (name: string) => sha(readFileSync(join(EVALS, "prompts", name), "utf8"));
  if (spec.kind === "local") return `local:${spec.model}@${h("judge-local.md")}+swap`;
  if (spec.kind === "decision") return `decision:${spec.model}@${h("judge-decision.md")}`;
  if (spec.kind === "claude") return `claude${spec.model ? ":" + spec.model : ""}@${h("judge.md")}`;
  if (spec.local.startsWith("decision:")) return `cascade(decision:${spec.local.slice(9)}@${h("judge-decision.md")}`;
  return `cascade(local:${spec.local}@${h("judge-local.md")}+swap`;
}

export async function runJudge(spec: JudgeSpec, video: string, scene: string, section: string, budgetUsd: number): Promise<JudgeResult> {
  const ctx = await judgeContext(video, scene, section);
  const rubric = loadRubric();
  if (spec.kind === "local") return localJudge(ctx, rubric, { model: spec.model });
  if (spec.kind === "decision") return decisionJudge(ctx, rubric, { model: spec.model });
  if (spec.kind === "claude") return claudeJudge(ctx, rubric, { model: spec.model, budgetUsd });
  return cascadeJudge(ctx, rubric, { local: spec.local, escalate: spec.escalate, claudeModel: spec.claudeModel, budgetUsd });
}
