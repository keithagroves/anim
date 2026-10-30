import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { loadVideo } from "../cli/load.js";
import { runJudge, parseJudge, loadRubric, allCriteria, judgeIdPrefix, type JudgeResult } from "./judge.js";
import { sectionMetrics, type SectionMetrics } from "./metrics.js";
import { runSut, type SutSpec } from "./sut.js";
import { agreement, ci, mean, pairedBootstrap, pct, pearson, quantile, wilson, type Agreement } from "./stats.js";
import { copyVideo, EVALS, isDir, newId, outputId, pool, readJson, readJsonl, ROOT, writeJson } from "./util.js";

export interface CaseMeta { id: string; scene: string; section: string; tags: string[]; source: string; createdAt: string; notes?: string }

export interface ResultRow {
  run: string;
  case: string;
  trial: number;
  scene: string;
  section: string;
  /** Video folder for this output, relative to the repo root. */
  dir: string;
  outputId: string | null;
  sut?: string;
  gen?: { ok: boolean; costUsd: number; durationMs: number; turns: number; friction: string[]; error?: string; report: string };
  metrics: SectionMetrics;
  judges: Record<string, JudgeResult>;
}

export interface RunMeta {
  id: string;
  createdAt: string;
  kind: "generate" | "snapshot";
  sut?: string;
  trials: number;
  cases: string[];
  budgetUsd?: number;
  baseline?: string;
  summary?: RunSummary;
}

export interface RunSummary { gate: number; n: number; costUsd: number; regression: boolean | null; notes: string[] }

const CASES = join(EVALS, "cases");
const RUNS = join(EVALS, "runs");
const LABELS = join(EVALS, "labels", "labels.jsonl");
const ALIGN = join(EVALS, "alignment.json");

export const runDir = (id: string) => join(RUNS, id);
export const loadRun = (id: string): { meta: RunMeta; rows: ResultRow[] } => {
  if (!existsSync(join(runDir(id), "run.json"))) throw new Error(`unknown run "${id}" (have: ${listRuns().join(", ") || "none"})`);
  return { meta: readJson(join(runDir(id), "run.json")), rows: readJson(join(runDir(id), "results.json")) };
};
const saveRun = (meta: RunMeta, rows: ResultRow[]) => {
  writeJson(join(runDir(meta.id), "run.json"), meta);
  writeJson(join(runDir(meta.id), "results.json"), rows);
};
export const listRuns = () => (isDir(RUNS) ? readdirSync(RUNS).filter((d) => existsSync(join(RUNS, d, "run.json"))).sort() : []);

// ---------------------------------------------------------------- cases

export function listCases(filter?: string): CaseMeta[] {
  if (!isDir(CASES)) return [];
  const all = readdirSync(CASES).filter((d) => existsSync(join(CASES, d, "case.json"))).map((d) => readJson<CaseMeta>(join(CASES, d, "case.json")));
  if (!filter) return all;
  const keys = filter.split(",");
  return all.filter((c) => keys.includes(c.id) || c.tags.some((t) => keys.includes(t)));
}

/** Freeze a section's inputs as a gold case: the whole video minus every section file (as in a real parallel run). */
export function addCase(video: string, scene: string, section: string, opts: { id?: string; tags?: string[]; source?: string; notes?: string } = {}): CaseMeta {
  const id = opts.id ?? `${basename(video)}-${scene}-${section}`;
  const dir = join(CASES, id);
  if (existsSync(join(dir, "case.json"))) throw new Error(`case "${id}" already exists`);
  copyVideo(video, join(dir, "video"), { dropSections: true });
  const type = JSON.parse(readFileSync(join(video, "project.json"), "utf8")).type;
  const tags = [...new Set([...(opts.tags ?? []), ...(type ? [`type:${type}`] : [])])];
  const meta: CaseMeta = { id, scene, section, tags, source: opts.source ?? `video:${relative(ROOT, video)}`, createdAt: new Date().toISOString(), notes: opts.notes };
  writeJson(join(dir, "case.json"), meta);
  return meta;
}

// ---------------------------------------------------------------- runs

export interface RunOpts { cases?: string; trials: number; sut: SutSpec; judge?: string; concurrency: number; budgetUsd: number; perRunUsd: number; baseline?: string; id?: string }

export async function runEval(o: RunOpts, log = console.log): Promise<string> {
  const cases = listCases(o.cases);
  if (!cases.length) throw new Error("no cases match");
  const id = o.id ?? newId("run-");
  const meta: RunMeta = { id, createdAt: new Date().toISOString(), kind: "generate", trials: o.trials, cases: cases.map((c) => c.id), budgetUsd: o.budgetUsd, baseline: o.baseline };
  const jobs = cases.flatMap((c) => Array.from({ length: o.trials }, (_, t) => ({ c, trial: t + 1 })));
  let spent = 0;
  const rows: ResultRow[] = [];
  log(`run ${id}: ${cases.length} cases × ${o.trials} trials = ${jobs.length} generations, budget $${o.budgetUsd}`);
  await pool(jobs, o.concurrency, async ({ c, trial }) => {
    const remaining = o.budgetUsd - spent;
    if (remaining < 0.25) { log(`  skip ${c.id} t${trial}: budget exhausted`); return; }
    const dir = join(runDir(id), c.id, `t${trial}`, "video");
    copyVideo(join(CASES, c.id, "video"), dir);
    const g = await runSut(o.sut, dir, c.scene, c.section, Math.min(o.perRunUsd, remaining));
    spent += g.costUsd;
    const metrics = sectionMetrics(dir, c.scene, c.section, g.scopeViolations);
    const row: ResultRow = {
      run: id, case: c.id, trial, scene: c.scene, section: c.section, dir: relative(ROOT, dir), outputId: g.outputId, sut: g.sut,
      gen: { ok: g.ok, costUsd: g.costUsd, durationMs: g.durationMs, turns: g.turns, friction: g.friction, error: g.error, report: g.report },
      metrics, judges: {},
    };
    meta.sut = g.sut;
    rows.push(row);
    saveRun(meta, rows);
    log(`  ${c.id} t${trial}: gate ${metrics.gate ? "PASS" : "FAIL"} · errors ${metrics.errors} · $${g.costUsd.toFixed(2)} · ${(g.durationMs / 1000).toFixed(0)}s${g.error ? " · " + g.error : ""}`);
  });
  saveRun(meta, sortRows(rows));
  if (o.judge) await judgeRun(id, o.judge, { budgetUsd: Math.max(0, o.budgetUsd - spent), concurrency: 1 }, log);
  return id;
}

const sortRows = (rows: ResultRow[]) => rows.sort((a, b) => a.case.localeCompare(b.case) || a.trial - b.trial);

/** Recompute deterministic metrics on existing outputs (after an engine or lint change). Free. */
export function regrade(id: string, log = console.log) {
  const { meta, rows } = loadRun(id);
  let flips = 0;
  for (const r of rows) {
    const before = r.metrics.gate;
    r.metrics = sectionMetrics(join(ROOT, r.dir), r.scene, r.section, r.metrics.scopeViolations);
    r.outputId = outputId(join(ROOT, r.dir, "scenes", r.scene, "sections", `${r.section}.json`));
    if (before !== r.metrics.gate) { flips++; log(`  ${r.case} t${r.trial}: gate ${before ? "PASS→FAIL" : "FAIL→PASS"}`); }
  }
  saveRun(meta, rows);
  log(`regraded ${rows.length} outputs, ${flips} gate changes`);
}

export async function judgeRun(id: string, judge: string, o: { budgetUsd: number; concurrency: number; force?: boolean }, log = console.log) {
  const spec = parseJudge(judge);
  const { meta, rows } = loadRun(id);
  let spent = 0;
  for (const r of rows) {
    if (!r.metrics.exists) { log(`  ${r.case} t${r.trial}: no output, skipped`); continue; }
    const prefix = judgeIdPrefix(spec);
    const already = Object.keys(r.judges).find((k) => k.startsWith(prefix) && (spec.kind !== "cascade" || spec.escalate === k.includes("→")));
    if (already && !o.force) { log(`  ${r.case} t${r.trial}: already judged by ${already}`); continue; }
    if (spec.kind !== "local" && o.budgetUsd - spent < 0.1) { log("  judge budget exhausted"); break; }
    try {
      const res = await runJudge(spec, join(ROOT, r.dir), r.scene, r.section, Math.min(1, o.budgetUsd - spent));
      spent += res.costUsd;
      r.judges[res.judge] = res;
      const fails = Object.entries(res.verdicts).filter(([, v]) => !v.pass).map(([k]) => k);
      const unc = Object.entries(res.verdicts).filter(([, v]) => v.uncertain).map(([k]) => k);
      log(`  ${r.case} t${r.trial}: ${res.judge} · fail: ${fails.join(", ") || "none"}${unc.length ? ` · uncertain: ${unc.join(", ")}` : ""}${res.escalated.length ? ` · escalated ${res.escalated.length}` : ""} · $${res.costUsd.toFixed(3)} · ${(res.durationMs / 1000).toFixed(1)}s${res.error ? " · " + res.error : ""}`);
      saveRun(meta, rows);
    } catch (e: any) {
      log(`  ${r.case} t${r.trial}: judge error: ${e.message}`);
    }
  }
  saveRun(meta, rows);
}

/** Turn the current sections of a video (e.g. hand-made or from an earlier pipeline) into a run. */
export function snapshot(video: string, name: string, log = console.log): string {
  const v = loadVideo(video);
  const id = name;
  if (existsSync(runDir(id))) throw new Error(`run "${id}" already exists`);
  const rows: ResultRow[] = [];
  const caseIds: string[] = [];
  for (const s of v.scenes) {
    if (!s.scene) continue;
    for (const sp of s.scene.spans) {
      const file = join(video, "scenes", s.id, "sections", `${sp.id}.json`);
      if (!existsSync(file)) continue;
      const caseId = `${basename(video)}-${s.id}-${sp.id}`;
      if (!existsSync(join(CASES, caseId, "case.json"))) { addCase(video, s.id, sp.id, { tags: ["seed"] }); log(`  + case ${caseId}`); }
      const dir = join(runDir(id), caseId, "t1", "video");
      copyVideo(video, dir);
      rows.push({
        run: id, case: caseId, trial: 1, scene: s.id, section: sp.id, dir: relative(ROOT, dir),
        outputId: outputId(join(dir, "scenes", s.id, "sections", `${sp.id}.json`)), sut: `snapshot:${relative(ROOT, video)}`,
        metrics: sectionMetrics(dir, s.id, sp.id), judges: {},
      });
      caseIds.push(caseId);
    }
  }
  saveRun({ id, createdAt: new Date().toISOString(), kind: "snapshot", sut: `snapshot:${relative(ROOT, video)}`, trials: 1, cases: caseIds }, rows);
  log(`snapshot ${id}: ${rows.length} outputs`);
  return id;
}

// ---------------------------------------------------------------- labels & alignment

export interface LabelRow { outputId: string; run: string; case: string; trial: number; labeler: string; rubricVersion: number; verdicts: Record<string, boolean>; notes: string; ts: string }

export const loadLabels = () => readJsonl<LabelRow>(LABELS);

/** Latest label per output (one labeler: the most recent wins). */
export function latestLabels(): Map<string, LabelRow> {
  const m = new Map<string, LabelRow>();
  for (const l of loadLabels()) m.set(l.outputId, l);
  return m;
}

export type Alignment = Record<string, Record<string, Agreement & { trusted: boolean }>>;
export const TRUST = { n: 10, kappa: 0.6, failRecall: 0.7 };

export function align(log = console.log): Alignment {
  const labels = latestLabels();
  const pairs: Record<string, Record<string, { human: boolean; judge: boolean }[]>> = {};
  const seen = new Set<string>();
  for (const id of listRuns()) {
    for (const r of loadRun(id).rows) {
      const l = r.outputId ? labels.get(r.outputId) : undefined;
      if (!l) continue;
      for (const [jid, jr] of Object.entries(r.judges)) {
        const key = `${jid}|${r.outputId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const [crit, v] of Object.entries(jr.verdicts)) {
          if (l.verdicts[crit] === undefined) continue;
          ((pairs[jid] ??= {})[crit] ??= []).push({ human: l.verdicts[crit], judge: v.pass });
        }
      }
    }
  }
  const out: Alignment = {};
  for (const [jid, crits] of Object.entries(pairs)) {
    out[jid] = {};
    for (const [crit, ps] of Object.entries(crits)) {
      const a = agreement(ps);
      out[jid][crit] = { ...a, trusted: a.n >= TRUST.n && a.kappa >= TRUST.kappa && (Number.isNaN(a.failRecall) ? false : a.failRecall >= TRUST.failRecall) };
    }
  }
  writeJson(ALIGN, { updatedAt: new Date().toISOString(), trustRule: TRUST, labels: labels.size, judges: out });
  if (!Object.keys(out).length) log(`no overlap between ${labels.size} human labels and judged outputs yet`);
  for (const [jid, crits] of Object.entries(out)) {
    log(`\n${jid}`);
    log(`  ${"criterion".padEnd(16)} ${"n".padStart(3)}  agree   κ      fail-recall  pass-recall  trusted`);
    for (const [crit, a] of Object.entries(crits))
      log(`  ${crit.padEnd(16)} ${String(a.n).padStart(3)}  ${pct(a.agreement).padStart(5)}  ${(Number.isNaN(a.kappa) ? "–" : a.kappa.toFixed(2)).padStart(5)}  ${pct(a.failRecall).padStart(11)}  ${pct(a.passRecall).padStart(11)}  ${a.trusted ? "yes" : "no"}`);
  }
  return out;
}

const loadAlignment = (): Alignment => (existsSync(ALIGN) ? readJson(ALIGN).judges : {});

// ---------------------------------------------------------------- reports

function caseGateRates(rows: ResultRow[]): Map<string, number> {
  const m = new Map<string, number[]>();
  for (const r of rows) (m.get(r.case) ?? m.set(r.case, []).get(r.case)!).push(r.metrics.gate ? 1 : 0);
  return new Map([...m].map(([k, v]) => [k, mean(v)]));
}

export function report(id: string, baselineId?: string): string {
  const { meta, rows } = loadRun(id);
  baselineId ??= meta.baseline;
  const rubric = loadRubric();
  const alignment = loadAlignment();
  const L: string[] = [];
  const notes: string[] = [];
  const n = rows.length;
  const gatePass = rows.filter((r) => r.metrics.gate).length;
  const cost = rows.reduce((a, r) => a + (r.gen?.costUsd ?? 0) + Object.values(r.judges).reduce((b, j) => b + j.costUsd, 0), 0);
  const byCase = new Map<string, ResultRow[]>();
  for (const r of rows) (byCase.get(r.case) ?? byCase.set(r.case, []).get(r.case)!).push(r);
  const passAtK = [...byCase.values()].filter((rs) => rs.some((r) => r.metrics.gate)).length;
  const passHatK = [...byCase.values()].filter((rs) => rs.every((r) => r.metrics.gate)).length;

  L.push(`# Eval report: ${id}`, "");
  L.push(`- kind: ${meta.kind} · SUT: \`${meta.sut ?? "?"}\` · cases: ${byCase.size} · trials: ${meta.trials} · outputs: ${n}`);
  L.push(`- total cost: $${cost.toFixed(2)}${meta.budgetUsd ? ` (budget $${meta.budgetUsd})` : ""}`);
  L.push("", "## Gate (deterministic)", "");
  L.push(`| metric | value |`, `|---|---|`);
  L.push(`| gate pass rate | ${ci(wilson(gatePass, n))} (${gatePass}/${n}) |`);
  if (meta.trials > 1) {
    L.push(`| pass@${meta.trials} (any trial passes) | ${ci(wilson(passAtK, byCase.size))} |`);
    L.push(`| pass^${meta.trials} (all trials pass) | ${ci(wilson(passHatK, byCase.size))} |`);
  }
  const gens = rows.filter((r) => r.gen);
  if (gens.length) {
    const c = gens.map((r) => r.gen!.costUsd), d = gens.map((r) => r.gen!.durationMs / 1000), t = gens.map((r) => r.gen!.turns);
    L.push(`| cost / section p50 · p95 | $${quantile(c, 0.5).toFixed(2)} · $${quantile(c, 0.95).toFixed(2)} |`);
    L.push(`| latency p50 · p95 | ${quantile(d, 0.5).toFixed(0)}s · ${quantile(d, 0.95).toFixed(0)}s |`);
    L.push(`| turns p50 | ${quantile(t, 0.5).toFixed(0)} |`);
  }
  const cov = rows.map((r) => r.metrics.cueCoverage).filter((x): x is number => x !== null);
  L.push(`| cue coverage (mean) | ${pct(mean(cov))} |`);
  L.push(`| max dead air (mean) | ${mean(rows.map((r) => r.metrics.maxGap)).toFixed(2)}s |`);
  const rules: Record<string, number> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.metrics.errorsByRule)) rules[k] = (rules[k] ?? 0) + v;
  if (Object.keys(rules).length) L.push(`| errors by rule | ${Object.entries(rules).map(([k, v]) => `${k} ×${v}`).join(", ")} |`);

  L.push("", "## Per case", "", "| case | trial | gate | errors | warnings | cue cov | max gap | entries | cost | turns |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows)
    L.push(`| ${r.case} | ${r.trial} | ${r.metrics.gate ? "✅" : "❌"} | ${Object.entries(r.metrics.errorsByRule).map(([k, v]) => `${k}×${v}`).join(" ") || 0} | ${r.metrics.warnings} | ${r.metrics.cueCoverage === null ? "–" : pct(r.metrics.cueCoverage)} | ${r.metrics.maxGap}s | ${r.metrics.entries} | ${r.gen ? "$" + r.gen.costUsd.toFixed(2) : "–"} | ${r.gen?.turns ?? "–"} |`);

  // Judges
  const judgeIds = [...new Set(rows.flatMap((r) => Object.keys(r.judges)))];
  for (const jid of judgeIds) {
    const judged = rows.filter((r) => r.judges[jid]);
    L.push("", `## Judge: \`${jid}\``, "");
    L.push("| criterion | pass rate | mean p(pass) | uncertain | mean order gap | trusted (vs human labels) |", "|---|---|---|---|---|---|");
    for (const cr of allCriteria(rubric)) {
      const vs = judged.map((r) => r.judges[jid].verdicts[cr.id]).filter(Boolean);
      if (!vs.length) continue;
      const ps = vs.map((v) => v.p).filter((p): p is number => p !== null);
      const al = alignment[jid]?.[cr.id];
      const gaps = vs.map((v) => v.orderGap).filter((g): g is number => g !== undefined);
      L.push(`| ${cr.id} | ${ci(wilson(vs.filter((v) => v.pass).length, vs.length))} | ${ps.length ? mean(ps).toFixed(2) : "–"} | ${vs.filter((v) => v.uncertain).length} | ${gaps.length ? mean(gaps).toFixed(2) + (mean(gaps) > 0.3 ? " ⚠" : "") : "–"} | ${al ? `${al.trusted ? "yes" : "no"} (n=${al.n}, κ=${al.kappa.toFixed(2)})` : "no labels yet"} |`);
    }
    const overall = judged.map((r) => (r.judges[jid].verdicts.overall?.pass ? 1 : 0));
    const sizes = judged.map((r) => r.metrics.entries);
    const rho = pearson(sizes, overall);
    if (!Number.isNaN(rho)) {
      const enough = judged.length >= 10;
      L.push("", `Size bias check: correlation between output size (entries) and overall pass = ${rho.toFixed(2)} (n=${judged.length})${!enough ? ", too few outputs to mean anything" : Math.abs(rho) > 0.5 ? " ⚠ judge may be rewarding (or punishing) size" : ""}.`);
    }
    const jc = judged.reduce((a, r) => a + r.judges[jid].costUsd, 0);
    const esc = judged.reduce((a, r) => a + r.judges[jid].escalated.length, 0);
    L.push("", `Judge cost $${jc.toFixed(3)} · escalated criteria ${esc}.`);
  }

  // Friction
  const friction = rows.flatMap((r) => (r.gen?.friction ?? []).map((f) => ({ f, case: r.case })));
  if (friction.length) {
    L.push("", "## Friction reported by the agent", "");
    for (const { f, case: c } of friction) L.push(`- (${c}) ${f}`);
  }

  // Baseline comparison
  let regression: boolean | null = null;
  if (baselineId) {
    const base = loadRun(baselineId);
    const a = caseGateRates(rows), b = caseGateRates(base.rows);
    const common = [...a.keys()].filter((k) => b.has(k));
    L.push("", `## vs baseline \`${baselineId}\``, "");
    if (!common.length) L.push("No cases in common.");
    else {
      const bs = pairedBootstrap(common.map((k) => [a.get(k)!, b.get(k)!]));
      regression = bs.hi < 0;
      const verdict = bs.hi < 0 ? "**regression**" : bs.lo > 0 ? "**improvement**" : "within noise";
      L.push(`Gate pass rate over ${common.length} common cases: ${pct(mean(common.map((k) => a.get(k)!)))} vs ${pct(mean(common.map((k) => b.get(k)!)))}, diff ${(bs.diff * 100).toFixed(0)}pp, 95% CI [${(bs.lo * 100).toFixed(0)}, ${(bs.hi * 100).toFixed(0)}]pp → ${verdict}.`);
      if (common.length < 10) notes.push(`only ${common.length} common cases: intervals are wide`);
      for (const jid of judgeIds) {
        const bj = base.rows.filter((r) => r.judges[jid]);
        if (!bj.length) continue;
        const rate = (rs: ResultRow[], cr: string) => mean(rs.filter((r) => r.judges[jid]?.verdicts[cr]).map((r) => (r.judges[jid].verdicts[cr].pass ? 1 : 0)));
        L.push("", `Judge \`${jid}\` pass rates (candidate vs baseline): ` + allCriteria(rubric).map((c) => `${c.id} ${pct(rate(rows, c.id))}/${pct(rate(bj, c.id))}`).join(" · "));
      }
    }
  }
  if (notes.length) L.push("", "## Notes", "", ...notes.map((x) => `- ${x}`));

  const md = L.join("\n") + "\n";
  writeFileSync(join(runDir(id), "report.md"), md);
  meta.summary = { gate: n ? gatePass / n : 0, n, costUsd: cost, regression, notes };
  writeJson(join(runDir(id), "run.json"), meta);
  return md;
}

export const resolveVideo = (p: string) => resolve(p);

// ---------------------------------------------------------------- A/B comparison

export interface CompareOpts { friction?: RegExp; judge?: string }

/** Paired A/B comparison of two runs over their common cases (pre-registered metrics for experiments). */
export function compare(aId: string, bId: string, o: CompareOpts = {}): string {
  const A = loadRun(aId).rows, B = loadRun(bId).rows;
  const byCase = (rows: ResultRow[]) => new Map(rows.map((r) => [r.case, r]));
  const a = byCase(A), b = byCase(B);
  const cases = [...a.keys()].filter((k) => b.has(k)).sort();
  const fr = o.friction ?? /(glob|\blist\b|array target|only supports? `?\*|straight|curv|\barc\b|\bbend)/i;
  const targeted = (r: ResultRow) => (r.gen?.friction ?? []).filter((f) => fr.test(f)).length;
  const jid = (r: ResultRow) => Object.keys(r.judges).find((k) => !o.judge || k.startsWith(o.judge));
  const jp = (r: ResultRow, crit: string) => { const j = jid(r); return j ? r.judges[j].verdicts[crit]?.p ?? null : null; };
  const med = (xs: number[]) => quantile(xs, 0.5);
  const L: string[] = [`# A/B: \`${aId}\` (A) vs \`${bId}\` (B)`, "", `${cases.length} paired cases.`, ""];
  L.push("| case | gate A | gate B | turns A | turns B | latency A | latency B | est. cost A | est. cost B | entries A | entries B | targeted friction A | B | overall p A | B |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const k of cases) {
    const x = a.get(k)!, y = b.get(k)!;
    const f = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "–" : v.toFixed(d));
    L.push(`| ${k} | ${x.metrics.gate ? "✅" : "❌"} | ${y.metrics.gate ? "✅" : "❌"} | ${x.gen?.turns ?? "–"} | ${y.gen?.turns ?? "–"} | ${f((x.gen?.durationMs ?? 0) / 1000, 0)}s | ${f((y.gen?.durationMs ?? 0) / 1000, 0)}s | $${f(x.gen?.costUsd)} | $${f(y.gen?.costUsd)} | ${x.metrics.entries} | ${y.metrics.entries} | ${targeted(x)} | ${targeted(y)} | ${f(jp(x, "overall"))} | ${f(jp(y, "overall"))} |`);
  }
  const pairs = (fn: (r: ResultRow) => number) => cases.map((k) => [fn(b.get(k)!), fn(a.get(k)!)] as [number, number]);
  const turns = pairs((r) => r.gen?.turns ?? NaN), gate = pairs((r) => (r.metrics.gate ? 1 : 0));
  const lat = pairs((r) => (r.gen?.durationMs ?? NaN) / 1000), cost = pairs((r) => r.gen?.costUsd ?? NaN);
  const ent = pairs((r) => r.metrics.entries);
  const fa = cases.reduce((s, k) => s + targeted(a.get(k)!), 0), fb = cases.reduce((s, k) => s + targeted(b.get(k)!), 0);
  const row = (name: string, ps: [number, number][], d = 1, unit = "") => {
    const bs = pairedBootstrap(ps);
    return `| ${name} | ${med(ps.map((p) => p[1])).toFixed(d)}${unit} | ${med(ps.map((p) => p[0])).toFixed(d)}${unit} | ${bs.diff.toFixed(d)}${unit} | [${bs.lo.toFixed(d)}, ${bs.hi.toFixed(d)}]${unit} |`;
  };
  L.push("", "## Summary (B − A, paired bootstrap over cases)", "", "| metric | median A | median B | mean diff | 95% CI |", "|---|---|---|---|---|");
  L.push(row("turns", turns, 1), row("gate pass", gate, 2), row("latency (s)", lat, 0), row("est. cost ($)", cost, 2), row("timeline entries", ent, 1));
  L.push(`| targeted friction mentions (total) | ${fa} | ${fb} | ${fb - fa} | – |`);
  const ov = cases.map((k) => [jp(b.get(k)!, "overall"), jp(a.get(k)!, "overall")]).filter((p): p is [number, number] => p[0] !== null && p[1] !== null);
  if (ov.length) L.push(row("judge p(overall)", ov, 2));

  // Pre-registered decision rule (notes/experiments/001).
  const r1 = med(turns.map((p) => p[0])) <= med(turns.map((p) => p[1]));
  const g = pairedBootstrap(gate);
  const r2 = !(g.hi < 0);
  const r3 = fb < fa;
  L.push("", "## Decision rule", "",
    `1. median turns B ≤ A: ${r1 ? "✅" : "❌"}`,
    `2. gate-pass interval for B − A not entirely below 0: ${r2 ? "✅" : "❌"} ([${g.lo.toFixed(2)}, ${g.hi.toFixed(2)}])`,
    `3. targeted friction B < A: ${r3 ? "✅" : "❌"} (${fb} vs ${fa})`,
    "", `**Verdict: ${r1 && r2 && r3 ? "ACCEPT" : "REJECT / ITERATE"}** (n=${cases.length}, 1 trial each: directional, not an effect-size claim).`);
  return L.join("\n") + "\n";
}
