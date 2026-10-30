// Experiment 002 analysis: the pre-registered decision rule in notes/experiments/002-house-numbers.md.
// Usage: npx tsx notes/experiments/002-analyze.mts <runA> <runB> [judge-prefix]  →  prints markdown
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pairedBootstrap, quantile, mean } from "../../src/evals/stats.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const [aId, bId, judgePrefix = "decision:clef-flash"] = process.argv.slice(2);
const HOUSE = ["thumbnail", "end-hold", "snap-off", "no-beat", "dead-air", "small-text", "ui-bounce", "busy"];
const NEW_PRESETS = ["words-in", "words-out", "lines-in", "lines-out", "breathe", "sway", "creep", "wobble", "clear"];

const load = (id: string) => JSON.parse(readFileSync(join(ROOT, "evals", "runs", id, "results.json"), "utf8")) as any[];
const A = new Map(load(aId).map((r) => [r.case, r])), B = new Map(load(bId).map((r) => [r.case, r]));
const cases = [...A.keys()].filter((k) => B.has(k)).sort();

const p = (r: any, crit: string): number | null => {
  const j = Object.keys(r.judges ?? {}).find((k) => k.startsWith(judgePrefix));
  return j ? r.judges[j].verdicts[crit]?.p ?? null : null;
};
const house = (r: any) => HOUSE.reduce((s, k) => s + (r.metrics.warningsByRule?.[k] ?? 0), 0);
const uses = (r: any) => {
  const f = join(ROOT, r.dir, "scenes", r.scene, "sections", `${r.section}.json`);
  if (!existsSync(f)) return [];
  const txt = readFileSync(f, "utf8");
  return NEW_PRESETS.filter((n) => txt.includes(`"${n}"`)).concat(/"at":\s*"(start|end)[-+]/.test(txt) ? ["time-grammar"] : []);
};
const f2 = (v: number | null) => (v === null || Number.isNaN(v) ? "–" : v.toFixed(2));
const med = (xs: number[]) => quantile(xs, 0.5);

const L: string[] = [`# Experiment 002 results: \`${aId}\` (A) vs \`${bId}\` (B)`, "", `${cases.length} paired cases, judge \`${judgePrefix}\`, rubric v2, both arms regraded and rendered by the current engine.`, ""];
L.push("| case | gate A | gate B | turns A | turns B | cost A | cost B | house warnings A | B | p(motion) A | B | p(overall) A | B | new vocabulary in B |");
L.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const k of cases) {
  const a = A.get(k)!, b = B.get(k)!;
  L.push(`| ${k} | ${a.metrics.gate ? "✅" : "❌"} | ${b.metrics.gate ? "✅" : "❌"} | ${a.gen.turns} | ${b.gen.turns} | $${a.gen.costUsd.toFixed(2)} | $${b.gen.costUsd.toFixed(2)} | ${house(a)} | ${house(b)} | ${f2(p(a, "motion"))} | ${f2(p(b, "motion"))} | ${f2(p(a, "overall"))} | ${f2(p(b, "overall"))} | ${uses(b).join(", ") || "–"} |`);
}

const pairs = (fn: (r: any) => number | null) =>
  cases.map((k) => [fn(B.get(k)!), fn(A.get(k)!)] as [number | null, number | null]).filter((x): x is [number, number] => x[0] !== null && x[1] !== null && !Number.isNaN(x[0]) && !Number.isNaN(x[1]));
const row = (name: string, ps: [number, number][], d = 2) => {
  if (!ps.length) return `| ${name} | – | – | – | – |`;
  const bs = pairedBootstrap(ps);
  return `| ${name} | ${med(ps.map((x) => x[1])).toFixed(d)} | ${med(ps.map((x) => x[0])).toFixed(d)} | ${bs.diff.toFixed(d)} | [${bs.lo.toFixed(d)}, ${bs.hi.toFixed(d)}] |`;
};
const gate = pairs((r) => (r.metrics.gate ? 1 : 0)), turns = pairs((r) => r.gen.turns);
const motion = pairs((r) => p(r, "motion")), overall = pairs((r) => p(r, "overall")), focus = pairs((r) => p(r, "focus"));
L.push("", "## Summary (B − A, paired bootstrap over cases)", "", "| metric | median A | median B | mean diff | 95% CI |", "|---|---|---|---|---|");
L.push(row("judge p(motion)", motion), row("judge p(overall)", overall), row("judge p(focus)", focus), row("gate pass", gate), row("turns", turns, 1),
  row("house-number warnings", pairs(house), 1), row("est. cost ($)", pairs((r) => r.gen.costUsd)), row("latency (s)", pairs((r) => r.gen.durationMs / 1000), 0), row("timeline entries", pairs((r) => r.metrics.entries), 1));

const byRule = (m: Map<string, any>) => Object.fromEntries(HOUSE.map((k) => [k, cases.reduce((s, c) => s + (m.get(c)!.metrics.warningsByRule?.[k] ?? 0), 0)]));
const ra = byRule(A), rb = byRule(B);
L.push("", "House-number warnings by rule (A → B): " + HOUSE.map((k) => `${k} ${ra[k]} → ${rb[k]}`).join(" · "));
const vocab = cases.flatMap((k) => uses(B.get(k)!));
L.push("", `New vocabulary used by B's agents: ${[...new Set(vocab)].map((v) => `${v} (${vocab.filter((x) => x === v).length}/${cases.length})`).join(", ") || "none"}.`);

const hA = cases.reduce((s, k) => s + house(A.get(k)!), 0), hB = cases.reduce((s, k) => s + house(B.get(k)!), 0);
const g = gate.length ? pairedBootstrap(gate) : { lo: 0, hi: 0 };
const r1 = !(g.hi < 0);
const r2 = med(turns.map((x) => x[0])) <= 1.1 * med(turns.map((x) => x[1]));
const r3 = hB < hA;
const dm = motion.length ? mean(motion.map(([b, a]) => b - a)) : NaN;
const r4 = motion.length > 0 && dm >= 0;
const verdict = !r1 || !r2 ? "REJECT" : r3 && r4 ? "ACCEPT" : r3 ? "ITERATE" : "ITERATE (rule 3 failed: a case the pre-registration did not name)";
L.push("", "## Decision rule (pre-registered)", "",
  `1. gate-pass interval for B − A not entirely below 0: ${r1 ? "✅" : "❌"} ([${g.lo.toFixed(2)}, ${g.hi.toFixed(2)}])`,
  `2. median turns B ≤ 1.1 × A: ${r2 ? "✅" : "❌"} (${med(turns.map((x) => x[0]))} vs ${med(turns.map((x) => x[1]))})`,
  `3. house-number warnings B < A: ${r3 ? "✅" : "❌"} (${hB} vs ${hA})`,
  `4. mean p(motion) B − A ≥ 0: ${r4 ? "✅" : "❌"} (${Number.isNaN(dm) ? "no judge scores" : dm.toFixed(3)})`,
  "", `**Verdict: ${verdict}** (n=${cases.length}, 1 trial each: directional, not an effect-size claim).`);
console.log(L.join("\n"));
