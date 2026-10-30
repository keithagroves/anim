# Evaluation framework

Goal: get past "performs well in our lab". There are two loops:

1. **Offline (in the lab):** a small gold set, a rubric of binary checks, an LLM judge that is **checked against human labels**, and a harness that runs on every change (prompt, preset, engine, docs, model).
2. **Online (in production):** every real generation is recorded as a trace. A small set of live signals, each with an owner, detects failure and drift. That drives **record → notify → analyze → propose → { accept & apply, reject }**, and what we learn from traces is promoted back into the gold set.

References: Eugene Yan, *Product evals* (label a small set, align the judge, run on every change); Hamel Husain, *Your AI product needs evals* (domain evals from real traces, binary pass/fail plus a written critique); Anthropic, *Demystifying evals for AI agents* (grading multi-step systems, pass@k vs pass^k, production monitoring alongside the suite); Shankar et al. 2024, *Who Validates the Validators?* (the judge must be checked against human labels, and criteria drift once people see outputs).

---

## 1. What we evaluate

The unit is a **section generation**: given a frozen scene (stage, keys, brief, narration and cues), an agent writes `sections/<id>.json`. This is the step that runs in parallel at scale, and it's where most quality is won or lost. Director and scene-planner evals follow the same pattern later.

The **system under test (SUT)** is whatever produces the section: today a headless Claude Code agent (`claude -p`) with a versioned prompt (`evals/prompts/section-agent.md`). Later, a Claude API agent. A SUT is identified by `runner + model + effort + prompt hash`.

## 2. Graders (cheapest first)

| Layer | Cost | Runs | What |
|---|---|---|---|
| **Deterministic** | free | every output, every change | compiles; lint errors in the target section; seams on both sides; scope (only the target file changed); cue coverage; dead air; offscreen/overlap/contrast/reading-time warnings; size of the output |
| **LLM judge (vision)** | ~cents per output | harness runs; sampled live traces | binary pass/fail + a short critique per rubric criterion, from a contact sheet + the narration with cue times |
| **Human labels** | minutes per output | small batches | the same binary criteria + "would ship as-is" + notes. This is the ground truth the judge is measured against |

**Gate** (an output fails outright if any of these fail): compiles, zero errors in the target section, scope ok.

## 3. Rubric

`evals/rubric.json` is versioned. Each criterion is a **binary question** with pass and fail definitions:

`narration_sync`, `focus`, `readability`, `composition`, `motion`, `style`, `accuracy`, plus `overall` ("would ship as-is").

Version 2 (2026-10-21): `motion` now cites the house numbers in `docs/motion.md` (stagger, settle, ease-only UI, no frozen holds, no snapping), the same rules the section agent reads.

Binary beats a 1–5 scale: it's faster to label, easier to agree on, and the critique carries the nuance. When labelling shows a criterion is ambiguous, or that a failure mode isn't covered, **change the rubric and bump its version**. That's expected, not a failure (criteria drift). Judge results and labels record the rubric version they used.

## 4. Judge alignment

`anim eval align` compares judge verdicts to human labels on the same outputs, per criterion:
- n, raw agreement, **Cohen's κ**
- **TPR on failures** (when a human says fail, does the judge?) and **TNR** (when a human says pass, does the judge agree?)

A criterion is **trusted** when n ≥ 10, κ ≥ 0.6 and fail-recall ≥ 0.7. Reports only use trusted criteria for gating. Untrusted ones are shown but marked, and they tell you where to fix the judge prompt or the rubric. Alignment is re-run whenever the judge prompt, the judge model or the rubric changes.

## 5. Harness

```
anim eval run     [--cases ids|tag] [--trials 3] [--model m] [--judge] [--concurrency 3] [--budget-usd 20] [--baseline <run>]
anim eval regrade <run>        # recompute deterministic metrics on existing outputs (engine/lint changed): free
anim eval judge   <run>        # judge (or re-judge) a run's outputs
anim eval report  <run> [--baseline <run>]
anim eval label   <run>        # labelling UI → evals/labels/labels.jsonl
anim eval align                # judge vs human agreement per criterion
anim eval snapshot <video> --name <run>   # turn current outputs (e.g. hand-made) into a run, so they can be judged or labelled
```

Each case × trial runs in its own copy of the case's video folder (`evals/runs/<run>/<case>/t<n>/video`), so trials can't interfere. Reports give:
- **gate pass rate**
- **pass@k** (any trial passes) and **pass^k** (all trials pass: the reliability number)
- judge pass rate per criterion (trusted marked)
- cost and latency p50/p95, turns
- lint errors by rule

All of it is shown against a baseline run, with regressions flagged.

**When to run what:** engine or lint change → `regrade` (free). Prompt, docs or model change → `run` on the gold set. Rubric or judge change → `judge` + `align`.

## 6. Production loop

### Record
Every real generation goes through `anim gen section <video> --scene <id> --section <id>`, which runs the SUT and writes a **trace** (`traces/<id>/trace.json`): the SUT identity, input hashes, the output hash, deterministic metrics, cost, latency, turns, and the agent's **friction report**. Later events are appended to the same trace:
- `human-edit`: the section changed after generation (detected at lint, render or export time), with edit size
- `export`: the section shipped in a render (the acceptance signal)
- `regenerate`: someone asked for it again (the rejection signal)
- `label` / `judge`: sampled quality checks

### Notify: the live signals (`monitor/signals.json`)
A small set, each with an **owner**, a threshold and a window:

| signal | what it catches |
|---|---|
| first-draft gate failure rate | capability regression (model, prompt or engine change) |
| seam failure rate at integration | contract drift between parallel agents |
| critique-round cap hit rate | the agent can't converge |
| human edit rate after generation | "lint-clean but not what people wanted" |
| regenerate rate | outright rejection |
| judge fail rate on sampled traces, per criterion | quality drift on live inputs |
| cost / latency p95 per section | runaway agents |
| input drift vs gold set (cues per section, section length, topic tags) | users asking for things the gold set doesn't cover |

`anim monitor` evaluates the signals over the window, appends alerts to `monitor/alerts.jsonl` and prints a summary (Slack or webhook later).

### Analyze
`anim monitor analyze` groups failing traces by lint rule, judge criterion and friction keywords, for error analysis (open coding first, then grouping into themes).

### Propose
`anim monitor propose` hands the groups (plus example traces) to Claude, which writes a proposal in `monitor/proposals/<id>.md`: what's failing, the suspected cause, a concrete change (prompt, docs, preset, engine) and how to verify it.

### Accept & apply / reject
`anim monitor decide <proposal> accept|reject --run <eval-run>`. Acceptance requires an eval run on the gold set **plus the promoted failing traces**, with no regression against the baseline. Later we can add a canary: route a share of live generations to the candidate SUT and compare live signals before applying it fully.

### Feed back
`anim eval promote <trace>` freezes a trace's input as a new gold case (tagged `from-trace`), with its human label if it has one. Every production failure we understand becomes a regression test.

---

## 7. Statistics

Small samples lie, so every rate in a report carries a **95% Wilson interval**, and run-vs-baseline differences use a **paired bootstrap over cases** (resampling cases, comparing per-case pass rates). A change is a regression only when the interval for the difference is below zero. Otherwise it's labelled "within noise", whatever the point estimate says. Multiple trials per case (default 3) separate an unreliable agent (pass@k high, pass^k low) from an incapable one (both low).

## 8. Judge design, biases and the cascade

**Budget rule:** the default path costs nothing. Deterministic graders and the local judge run on every output, and Claude is opt-in, capped (`--budget-usd`) and used only where the local judge is unsure.

- **Local typed judges (JEV-style, free).** Two kinds, both returning p(pass) per criterion instead of generated text:
  - `decision:clef-flash`: an Ollama *decision model* (9B, vision, Apache-2.0) called through `POST /v1/systemone` with a `state`, the contact sheet as a shared image, and every criterion as a `noul` (yes/no) question. All criteria are decided jointly in one call (~15–20s on an M4 Pro), there are no answer letters (so no letter bias), and it produces zero output tokens.
  - `local:gemma4:e4b`: a chat vision model asked one "A) pass / B) fail" question per criterion. We read the **option-letter log-probabilities**. The image and context come first in the prompt, so Ollama's prompt cache makes each extra question cost ~0.2–0.5s.
- **Letter-order debiasing (letter-logit judges):** every question is asked twice, with A=pass and with A=fail, and the two probabilities are averaged. The gap between the two orders is recorded per criterion. On day one, `narration_sync` gave p=0.57 with one order and 0.03 with the other: pure letter bias. A gap > 0.3 marks the verdict **uncertain**.
- **Cascade:** deterministic → local typed judge → (opt-in) Claude, only for criteria that are uncertain (p in 0.25–0.75, or order gap > 0.3). Judge specs: `local:<model>`, `cascade:<model>` (flags but never escalates), `cascade+claude:<model>`, `claude[:model]`.
- **Pins:** the Claude judge pins each failed criterion to up to 3 spots, `{ at, x, y, w, h, note }`: the time under the frame and, when it is one place, a point or box as fractions of the frame. The labelling UI shows them after your label is saved, and a click jumps the player there and outlines the spot (`#t=12.4&x=0.42&y=0.41`).
- **Pointwise and binary, not pairwise:** each output is judged alone, which avoids position bias between outputs. The Claude judge writes its critique before the verdict.
- **Self-preference:** the Claude judge and the SUT are both Claude. Human alignment is the check, and the local judge comes from a different model family.
- **Size bias:** reports show the correlation between judge pass rate and output size (entries). A judge that rewards busy outputs shows up here.
- **Blind labelling:** the labelling UI hides judge verdicts until your label is saved.
- **Versioned judges:** a judge's id includes the hash of its prompt template and method (`+swap`). Changing either counts as a new judge, which needs its own alignment.
- **Next:** a local text-only typed judge (ModernBERT-class decision model such as `laya`, or an embedding + logistic-regression classifier trained on our labels) for text-derivable criteria, measured for agreement and cost against the vision judge.

## 9. Voice graders

The narration is a model output too. `anim eval voice <video>` checks every scene's `vo.wav`:
- **Word error rate:** transcribe the audio back with Whisper and compare to `narration.txt`. Catches skipped, garbled or mispronounced words (did it say it correctly?).
- **Timestamp drift:** Kokoro word start times vs Whisper's, gated on the median (p95 is informational). Whisper's own word timings are only ±100–200ms and it snaps the first word to 0, so this measures agreement between two noisy clocks. A forced aligner is the proper reference later.
- **Pacing:** words per minute, longest pause, leading and trailing silence.
- **Loudness:** integrated LUFS and true peak (EBU R128), measured on the **rendered mix** when it exists. The first version measured raw `vo.wav` (−25 LUFS) and "failed" audio that render normalises to −16.

## 10. Layout

```
evals/
  rubric.json
  prompts/section-agent.md    # SUT prompt (versioned by hash)
  prompts/judge.md            # judge prompt (versioned by hash)
  cases/<case>/case.json      # { id, scene, section, tags, source }
  cases/<case>/video/         # frozen inputs: project, theme, style, scene.json, narration, vo.*; no target section
  labels/labels.jsonl         # human labels, keyed by output hash
  runs/<run>/run.json, results.jsonl, report.md, <case>/t<n>/video/...
traces/<trace>/trace.json
monitor/signals.json, alerts.jsonl, proposals/
```

Outputs are identified by a **content hash** of the section file, so labels and judge verdicts attach to the content itself, wherever it came from.
