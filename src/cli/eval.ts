import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { addCase, align, compare, judgeRun, listCases, listRuns, regrade, report, runEval, snapshot } from "../evals/harness.js";
import { startLabelServer } from "../evals/label.js";
import { analyze, decide, monitor, propose } from "../evals/monitor.js";
import { genSection, promoteTrace } from "../evals/traces.js";
import { voiceEval } from "../evals/voice.js";
import { ollamaHas } from "../evals/runners.js";
import { pool } from "../evals/util.js";
import { loadVideo } from "./load.js";
import { DEV_HELP, unknownCommand } from "./help.js";

const DEFAULT_JUDGE = "cascade:gemma4:e4b";

export async function evalCli(cmd: string, argv: string[]) {
  const [sub, ...rest] = argv;
  const { values: o, positionals: pos } = parseArgs({
    args: rest, allowPositionals: true,
    options: {
      scene: { type: "string" }, section: { type: "string" }, tags: { type: "string" }, cases: { type: "string" },
      trials: { type: "string" }, model: { type: "string" }, effort: { type: "string" }, judge: { type: "string" },
      concurrency: { type: "string" }, "budget-usd": { type: "string" }, "per-run-usd": { type: "string" },
      baseline: { type: "string" }, id: { type: "string" }, port: { type: "string" }, labeler: { type: "string" },
      force: { type: "boolean" }, notify: { type: "boolean" }, days: { type: "string" }, run: { type: "string" },
      note: { type: "string" }, "judge-sample": { type: "string" }, sections: { type: "string" }, kind: { type: "string" },
    },
  });
  const num = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));
  const sut = { runner: "claude-code" as const, model: o.model, effort: o.effort };

  const checkJudge = async (spec?: string) => {
    const s = spec ?? DEFAULT_JUDGE;
    const m = s.match(/^(?:local|decision|cascade|cascade\+claude):(?:decision:)?(.+)$/);
    if (m && !(await ollamaHas(m[1]))) throw new Error(`local judge model "${m[1]}" is not in Ollama (ollama pull ${m[1]})`);
    return s;
  };

  if (cmd === "gen" && sub === "scene") {
    if (!pos[0] || !o.scene) throw new Error("usage: gen scene <video> --scene id [--sections s1,s2]");
    const v = loadVideo(resolve(pos[0]));
    const sc = v.scenes.find((s) => s.id === o.scene);
    if (!sc?.scene) throw new Error(`unknown or broken scene "${o.scene}"`);
    const want = o.sections ? o.sections.split(",").map((x) => x.trim()) : sc.scene.spans.filter((s) => s.placeholder).map((s) => s.id);
    const unknown = want.filter((id) => !sc.scene!.spans.some((s) => s.id === id));
    if (unknown.length) throw new Error(`unknown section(s): ${unknown.join(", ")}`);
    if (!want.length) { console.log("every section is written; name some with --sections to regenerate them"); return; }
    const judge = o.judge === "none" ? undefined : await checkJudge(o.judge);
    console.log(`generating ${want.length} section(s) of ${o.scene} in parallel: ${want.join(", ")}`);
    const results = await pool(want, num(o.concurrency, 3), (section) =>
      genSection(pos[0], o.scene!, section, { sut, budgetUsd: num(o["budget-usd"], 2.5), judge, judgeSample: num(o["judge-sample"], 1) }, (m) => console.log(`[${section}] ${m}`))
        .then((t) => ({ section, ok: t.metrics.gate, cost: t.gen.costUsd }), (e) => ({ section, ok: false, cost: 0, error: String(e?.message ?? e) })));
    for (const r of results) console.log(`${r.ok ? "✓" : "✖"} ${r.section} · $${r.cost.toFixed(2)}${"error" in r ? " · " + r.error : ""}`);
    console.log(`total $${results.reduce((a, r) => a + r.cost, 0).toFixed(2)}; now run anim lint for the seams between them`);
    return;
  }

  if (cmd === "gen") {
    if (!sub) { console.error(DEV_HELP.gen); process.exit(1); }
    if (sub !== "section") unknownCommand("gen", sub, ["section", "scene"]);
    if (!pos[0] || !o.scene || !o.section) throw new Error("usage: gen section <video> --scene id --section id");
    const judge = o.judge === "none" ? undefined : await checkJudge(o.judge);
    await genSection(pos[0], o.scene, o.section, { sut, budgetUsd: num(o["budget-usd"], 2.5), judge, judgeSample: num(o["judge-sample"], 1) });
    return;
  }

  if (cmd === "monitor") {
    if (!sub || sub === "--notify") { monitor({ notify: o.notify || sub === "--notify" }); return; }
    if (sub === "analyze") { analyze({ days: o.days ? Number(o.days) : undefined, run: o.run }); return; }
    if (sub === "propose") { if (!pos[0]) throw new Error("usage: monitor propose <analysis.md>"); await propose(resolve(pos[0]), num(o["budget-usd"], 1), console.log, o.kind === "rule" ? "rule" : "change"); return; }
    if (sub === "decide") {
      const [id, d] = pos;
      if (!id || (d !== "accept" && d !== "reject")) throw new Error("usage: monitor decide <proposal> accept|reject [--run id]");
      decide(id, d, { run: o.run, note: o.note, force: o.force });
      return;
    }
    unknownCommand("monitor", sub, ["analyze", "propose", "decide"]);
  }

  switch (sub) {
    case "cases":
      for (const c of listCases()) console.log(`${c.id.padEnd(40)} ${c.scene}/${c.section}  [${c.tags.join(", ")}]  ${c.source}`);
      return;
    case "runs":
      for (const r of listRuns()) console.log(r);
      return;
    case "add-case": {
      if (!pos[0] || !o.scene || !o.section) throw new Error("usage: eval add-case <video> --scene id --section id");
      const c = addCase(resolve(pos[0]), o.scene, o.section, { id: o.id, tags: o.tags?.split(",") });
      console.log(`added case ${c.id}`);
      return;
    }
    case "run": {
      const judge = o.judge ? (o.judge === "none" ? undefined : await checkJudge(o.judge)) : await checkJudge();
      const id = await runEval({
        cases: o.cases, trials: num(o.trials, 1), sut, judge, concurrency: num(o.concurrency, 2),
        budgetUsd: num(o["budget-usd"], 5), perRunUsd: num(o["per-run-usd"], 2.5), baseline: o.baseline, id: o.id,
      });
      console.log("\n" + report(id, o.baseline));
      return;
    }
    case "snapshot": {
      if (!pos[0] || !o.id) throw new Error("usage: eval snapshot <video> --id name");
      snapshot(resolve(pos[0]), o.id);
      console.log("\n" + report(o.id));
      return;
    }
    case "regrade": regrade(pos[0]); console.log("\n" + report(pos[0], o.baseline)); return;
    case "judge": {
      const judge = await checkJudge(o.judge);
      await judgeRun(pos[0], judge, { budgetUsd: num(o["budget-usd"], 1), concurrency: 1, force: o.force });
      console.log("\n" + report(pos[0], o.baseline));
      return;
    }
    case "report": console.log(report(pos[0], o.baseline)); return;
    case "label": {
      const srv = await startLabelServer(pos[0], num(o.port, 5174), o.labeler ?? process.env.USER ?? "human");
      console.log(`labelling ${pos[0]}: ${srv.url}/label`);
      return;
    }
    case "align": align(); return;
    case "compare": {
      if (pos.length < 2) throw new Error("usage: eval compare <runA> <runB> [--judge prefix]");
      console.log(compare(pos[0], pos[1], { judge: o.judge }));
      return;
    }
    case "voice": voiceEval(pos[0]); return;
    case "promote": {
      const c = promoteTrace(pos[0], { tags: o.tags?.split(",") });
      console.log(`promoted to case ${c.id}`);
      return;
    }
  }
  if (!sub) { console.error(DEV_HELP.eval); process.exit(1); }
  unknownCommand("eval", sub, ["cases", "runs", "add-case", "run", "snapshot", "regrade", "judge", "report", "label", "align", "compare", "voice", "promote"]);
}
