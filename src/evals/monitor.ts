import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { listTraces, inputFeatures, type Trace } from "./traces.js";
import { listCases, loadRun } from "./harness.js";
import { runClaude } from "./runners.js";
import { mean, quantile, wilson } from "./stats.js";
import { appendJsonl, EVALS, MONITOR, newId, readJson, ROOT, writeJson } from "./util.js";

const MOTION_DOC = join(ROOT, "docs", "motion.md");

const RULE_PROMPT = (analysis: string) => `You maintain an AI animation engine (repo in the current directory). Section agents (prompt: evals/prompts/section-agent.md) follow docs/format.md and docs/motion.md, "the house numbers": craft rules, each a number with a tag naming the review it came from. Below is a failure analysis from production traces and eval runs.

Read docs/motion.md first. Propose ONE new rule for it (or a sharper number for an existing one) that would have prevented the most important recurring failure in the analysis. Rules are numbers, not adjectives. Do not edit anything.

Write markdown with exactly these sections:
## Section
The exact heading in docs/motion.md the rule belongs under (for example "## 2. Entrances, exits, moves").
## Rule
ONE bullet line in the file's style: "- <rule with a number>. [ours: <trace ids or case ids from the analysis>]" (add "[lint: <rule>]" only if an existing lint rule checks it).
## Evidence
Which traces or cases failed this way, and how often (cite the analysis).
## Verification
Which eval cases to run and which metric or lint count should move.

--- ANALYSIS ---
${analysis}`;

/** Insert an accepted rule line at the end of its section of docs/motion.md. */
export function applyRule(proposal: string, doc = MOTION_DOC): string {
  const section = /##\s*Section\s*\n+\s*(#+[^\n]+)/i.exec(proposal)?.[1]?.trim();
  const rule = /##\s*Rule\s*\n+\s*(-\s[^\n]+)/i.exec(proposal)?.[1]?.trim();
  if (!section || !rule) throw new Error("the proposal has no \"## Section\" heading line or no \"## Rule\" bullet");
  if (!/\[(ours|M|lint)[:\]]/.test(rule)) throw new Error(`the rule has no evidence tag: ${rule}`);
  const lines = readFileSync(doc, "utf8").split("\n");
  const at = lines.findIndex((l) => l.trim() === section);
  if (at < 0) throw new Error(`docs/motion.md has no heading "${section}"`);
  let end = at + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  while (end > at + 1 && lines[end - 1].trim() === "") end--;
  lines.splice(end, 0, rule);
  writeFileSync(doc, lines.join("\n"));
  return `${section}: ${rule}`;
}

type Pred = (t: Trace) => boolean;
const PREDICATES: Record<string, Pred> = {
  all: () => true,
  gate_fail: (t) => !t.metrics.gate,
  seam_fail: (t) => (t.metrics.errorsByRule.seam ?? 0) > 0 || t.events.some((e) => e.type === "seam-fail"),
  exported: (t) => t.events.some((e) => e.type === "export"),
  edited_at_export: (t) => t.events.some((e) => e.type === "export" && e.edited),
  regenerated: (t) => t.events.some((e) => e.type === "regenerate"),
  judged: (t) => !!t.judge,
};
const METRICS: Record<string, (t: Trace) => number> = {
  cost: (t) => t.gen.costUsd,
  latency_s: (t) => t.gen.durationMs / 1000,
  turns: (t) => t.gen.turns,
};

export interface Signal {
  id: string;
  owner: string;
  why: string;
  kind: "rate" | "quantile" | "judge" | "drift";
  num?: string; den?: string; threshold?: number;
  metric?: string; q?: number;
  criterion?: string;
  feature?: keyof Trace["features"]; z?: number;
  severity: "high" | "medium" | "low";
}
export interface SignalsFile { window: { days: number; minTraces: number }; signals: Signal[] }

export interface SignalStatus { id: string; owner: string; status: "ok" | "alert" | "insufficient"; value: string; threshold: string; n: number; why: string; severity: string }

export function loadSignals(): SignalsFile { return readJson(join(MONITOR, "signals.json")); }

function inWindow(days: number): Trace[] {
  const since = Date.now() - days * 86400_000;
  return listTraces().filter((t) => Date.parse(t.ts) >= since);
}

/** Feature distribution of the gold set, for input drift. */
function goldFeatures(): Trace["features"][] {
  return listCases().map((c) => inputFeatures(join(EVALS, "cases", c.id, "video"), c.scene, c.section));
}

export function evaluateSignals(cfg = loadSignals()): SignalStatus[] {
  const traces = inWindow(cfg.window.days);
  const out: SignalStatus[] = [];
  for (const s of cfg.signals) {
    const base = { id: s.id, owner: s.owner, why: s.why, severity: s.severity };
    if (s.kind === "rate") {
      const den = traces.filter(PREDICATES[s.den ?? "all"]);
      const k = den.filter(PREDICATES[s.num!]).length;
      const w = wilson(k, den.length);
      // Alert on the point estimate, and show the interval so the owner can see how certain it is.
      out.push({ ...base, n: den.length, threshold: `≤ ${(s.threshold! * 100).toFixed(0)}%`,
        value: den.length ? `${(w.p * 100).toFixed(0)}% [${(w.lo * 100).toFixed(0)}–${(w.hi * 100).toFixed(0)}] (${k}/${den.length})` : "–",
        status: den.length < cfg.window.minTraces ? "insufficient" : w.p > s.threshold! ? "alert" : "ok" });
    } else if (s.kind === "quantile") {
      const xs = traces.map(METRICS[s.metric!]);
      const v = quantile(xs, s.q ?? 0.95);
      out.push({ ...base, n: xs.length, threshold: `≤ ${s.threshold}`, value: xs.length ? v.toFixed(2) : "–",
        status: xs.length < cfg.window.minTraces ? "insufficient" : v > s.threshold! ? "alert" : "ok" });
    } else if (s.kind === "judge") {
      const judged = traces.filter((t) => t.judge);
      const crits = s.criterion === "*" ? [...new Set(judged.flatMap((t) => Object.keys(t.judge!.verdicts)))] : [s.criterion!];
      for (const c of crits) {
        const vs = judged.map((t) => t.judge!.verdicts[c]).filter(Boolean);
        const k = vs.filter((v) => !v.pass).length;
        const w = wilson(k, vs.length);
        out.push({ ...base, id: `${s.id}:${c}`, n: vs.length, threshold: `≤ ${(s.threshold! * 100).toFixed(0)}%`,
          value: vs.length ? `${(w.p * 100).toFixed(0)}% [${(w.lo * 100).toFixed(0)}–${(w.hi * 100).toFixed(0)}]` : "–",
          status: vs.length < cfg.window.minTraces ? "insufficient" : w.p > s.threshold! ? "alert" : "ok" });
      }
      if (!crits.length) out.push({ ...base, n: 0, threshold: `≤ ${(s.threshold! * 100).toFixed(0)}%`, value: "–", status: "insufficient" });
    } else if (s.kind === "drift") {
      const gold = goldFeatures().map((f) => f[s.feature!]);
      const live = traces.map((t) => t.features[s.feature!]);
      const gm = mean(gold), gsd = Math.sqrt(mean(gold.map((x) => (x - gm) ** 2))) || 1;
      const lm = mean(live);
      const z = (lm - gm) / gsd;
      out.push({ ...base, n: live.length, threshold: `|z| ≤ ${s.z ?? 2} vs gold mean ${gm.toFixed(1)}`,
        value: live.length ? `live mean ${lm.toFixed(1)} (z=${z.toFixed(1)})` : "–",
        status: live.length < cfg.window.minTraces || gold.length < 2 ? "insufficient" : Math.abs(z) > (s.z ?? 2) ? "alert" : "ok" });
    }
  }
  return out;
}

/** Notify: print, append alerts to the log, optionally raise a desktop notification. */
export function monitor(opts: { notify?: boolean } = {}, log = console.log): SignalStatus[] {
  const cfg = loadSignals();
  const st = evaluateSignals(cfg);
  const n = inWindow(cfg.window.days).length;
  log(`monitor: ${n} traces in the last ${cfg.window.days} days (min ${cfg.window.minTraces} per signal)\n`);
  for (const s of st) {
    const icon = s.status === "alert" ? "🔴" : s.status === "ok" ? "🟢" : "⚪";
    log(`${icon} ${s.id.padEnd(30)} ${s.value.padEnd(30)} ${s.threshold.padEnd(26)} owner: ${s.owner}`);
  }
  const alerts = st.filter((s) => s.status === "alert");
  for (const a of alerts) appendJsonl(join(MONITOR, "alerts.jsonl"), { ts: new Date().toISOString(), ...a });
  if (alerts.length && opts.notify && process.platform === "darwin")
    spawnSync("osascript", ["-e", `display notification "${alerts.map((a) => a.id).join(", ")}" with title "anim: ${alerts.length} alert(s)"`]);
  log(alerts.length ? `\n${alerts.length} alert(s). Next: anim monitor analyze` : "\nno alerts");
  return st;
}

// ---------------------------------------------------------------- analyze

const STOP = new Set("the a an to of and or in on for is it i was with that this as be by at from not no but can there my so had have when which into would could".split(" "));

/** Group failing traces (and failing outputs in an eval run) by rule, judge criterion and friction theme. */
export function analyze(opts: { days?: number; run?: string } = {}, log = console.log): string {
  const cfg = loadSignals();
  type Item = { id: string; failing: boolean; rules: string[]; judgeFails: string[]; friction: string[]; edited: boolean; regenerated: boolean };
  const items: Item[] = [];
  for (const t of inWindow(opts.days ?? cfg.window.days)) {
    items.push({
      id: t.id, failing: !t.metrics.gate || PREDICATES.edited_at_export(t) || PREDICATES.regenerated(t) || Object.values(t.judge?.verdicts ?? {}).some((v) => !v.pass),
      rules: Object.keys(t.metrics.errorsByRule), judgeFails: Object.entries(t.judge?.verdicts ?? {}).filter(([, v]) => !v.pass).map(([k]) => k),
      friction: t.gen.friction, edited: PREDICATES.edited_at_export(t), regenerated: PREDICATES.regenerated(t),
    });
  }
  if (opts.run) {
    for (const r of loadRun(opts.run).rows) {
      const jf = Object.values(r.judges).flatMap((j) => Object.entries(j.verdicts).filter(([, v]) => !v.pass).map(([k]) => k));
      items.push({ id: `${r.run}/${r.case}/t${r.trial}`, failing: !r.metrics.gate || jf.length > 0, rules: Object.keys(r.metrics.errorsByRule), judgeFails: jf, friction: r.gen?.friction ?? [], edited: false, regenerated: false });
    }
  }
  const failing = items.filter((i) => i.failing);
  const count = (xs: string[]) => Object.entries(xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  // Friction themes: frequent content words and bigrams across all friction reports.
  const allFriction = items.flatMap((i) => i.friction);
  const grams: string[] = [];
  for (const f of allFriction) {
    const w = f.toLowerCase().replace(/[`*_"'()[\]{}:,.;]/g, " ").split(/\s+/).filter((x) => x.length > 2 && !STOP.has(x));
    const uniq = new Set<string>();
    w.forEach((x, i) => { uniq.add(x); if (w[i + 1]) uniq.add(`${x} ${w[i + 1]}`); });
    grams.push(...uniq);
  }
  const L: string[] = [`# Failure analysis (${new Date().toISOString().slice(0, 16)})`, "", `${failing.length} failing of ${items.length} items${opts.run ? ` (traces + run ${opts.run})` : ""}.`, ""];
  L.push("## Lint error rules", "", ...count(failing.flatMap((i) => i.rules)).map(([k, v]) => `- ${k}: ${v}`), "");
  L.push("## Judge criteria failed", "", ...count(failing.flatMap((i) => i.judgeFails)).map(([k, v]) => `- ${k}: ${v}`), "");
  L.push(`## Human signals`, "", `- edited after generation: ${items.filter((i) => i.edited).length}`, `- regenerated: ${items.filter((i) => i.regenerated).length}`, "");
  L.push("## Friction themes (recurring terms across agent reports)", "", ...count(grams).filter(([, v]) => v >= 2).slice(0, 15).map(([k, v]) => `- "${k}": ${v}`), "");
  L.push("## Friction reports (verbatim)", "", ...items.flatMap((i) => i.friction.map((f) => `- (${i.id}) ${f}`)), "");
  const md = L.join("\n");
  const path = join(MONITOR, "analysis", `${newId("an-")}.md`);
  writeJson(path.replace(/\.md$/, ".json"), { items });
  writeFileSync(path, md);
  log(md);
  log(`\nwritten: ${path}`);
  return path;
}

// ---------------------------------------------------------------- propose / decide

export async function propose(analysisPath: string, budgetUsd: number, log = console.log, kind: "change" | "rule" = "change"): Promise<string> {
  const analysis = readFileSync(analysisPath, "utf8");
  const r = await runClaude({
    prompt: kind === "rule" ? RULE_PROMPT(analysis) : `You maintain an AI animation engine (repo in the current directory). Section agents (prompt: evals/prompts/section-agent.md, reference: docs/format.md, engine: src/engine/) generate animation sections. Below is a failure analysis from production traces and eval runs.

Propose ONE change most likely to reduce the most important failure. You may read files to ground the proposal, but do not edit anything.

Write the proposal in markdown with exactly these sections:
## Problem
What is failing and how often (cite the analysis).
## Hypothesis
The suspected root cause.
## Change
The concrete change: which file(s), and the exact edit (diff or precise description). Prefer the smallest change that addresses the cause: docs or prompt before engine.
## Verification
Which eval cases to run (include promoted from-trace cases), which metric should move, and what would count as a regression.
## Risk
What could get worse.

--- ANALYSIS ---
${analysis}`,
    tools: ["Read", "Glob", "Grep"], allowedTools: ["Read", "Glob", "Grep"], budgetUsd,
  });
  if (!r.ok) throw new Error(r.error);
  const id = newId("prop-");
  const path = join(MONITOR, "proposals", `${id}.md`);
  writeJson(path.replace(/\.md$/, ".json"), { id, kind, status: "proposed", createdAt: new Date().toISOString(), analysis: analysisPath, costUsd: r.costUsd });
  writeFileSync(path, r.text);
  log(r.text);
  log(`\nproposal ${id} ($${r.costUsd.toFixed(2)}) → ${path}\nNext: apply it on a branch, run \`anim eval run --baseline <run>\`, then \`anim monitor decide ${id} accept|reject --run <run>\``);
  return id;
}

export function decide(id: string, decision: "accept" | "reject", opts: { run?: string; note?: string; force?: boolean }, log = console.log) {
  const metaPath = join(MONITOR, "proposals", `${id}.json`);
  if (!existsSync(metaPath)) throw new Error(`unknown proposal ${id} (have: ${listProposals().join(", ") || "none"})`);
  const meta = readJson(metaPath);
  if (decision === "accept" && !opts.force) {
    if (!opts.run) throw new Error("accepting needs --run <eval run> showing no regression (or --force)");
    const { meta: run } = loadRun(opts.run);
    if (!run.summary) throw new Error(`run ${opts.run} has no report yet: run \`anim eval report ${opts.run} --baseline <run>\``);
    if (run.summary.regression === true) throw new Error(`run ${opts.run} shows a regression against its baseline; not accepting (use --force to override)`);
    if (run.summary.regression === null) log(`warning: run ${opts.run} was not compared to a baseline`);
  }
  // A rule proposal is a line for docs/motion.md: accepting it writes the line there.
  if (decision === "accept" && meta.kind === "rule") log(`added to docs/motion.md → ${applyRule(readFileSync(metaPath.replace(/\.json$/, ".md"), "utf8"))}`);
  Object.assign(meta, { status: decision === "accept" ? "accepted" : "rejected", decidedAt: new Date().toISOString(), run: opts.run, note: opts.note });
  writeJson(metaPath, meta);
  appendJsonl(join(MONITOR, "decisions.jsonl"), meta);
  log(`proposal ${id}: ${meta.status}`);
}

export const listProposals = () => (existsSync(join(MONITOR, "proposals")) ? readdirSync(join(MONITOR, "proposals")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : []);
