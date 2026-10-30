# Experiment 001: Does fixing the top agent friction make section agents better?

*Pre-registered 2026-10-10, before any treatment results were seen.*

## Background
Across 7 section-agent runs (2 videos), the most frequent friction reports were:
- **Glob-only targets** (4 of 7 agents): `tok*` also matches `tok1Box`/`tok1Text`, so staggering a set of groups needs one entry per object with hand-tuned offsets.
- **Straight-line-only arrows** (3 of 7): curved attention arcs had to be drawn as hand-computed full-canvas `path`s. The s2 transformers agent wrote 27 of them.

## Hypothesis
Adding **list targets** (`"target": ["podA", "podB", "podC"]`, staggered in list order) and **curved arrows** (`"bend": 80` on `line`/`arrow`) reduces the effort section agents spend, without hurting quality.

## Design
- **Cases:** the 7 gold cases (`--cases seed`): 3 Kubernetes and 4 transformers sections.
- **Arms:** A = baseline (current engine and docs); B = treatment (engine + `docs/format.md` with the two features). Same SUT prompt, model and settings. 1 trial per case per arm = 14 runs.
- Both arms run **concurrently** (B in an isolated copy of the repo), concurrency 2 each.
- Judged afterwards with the free local judge `decision:clef-flash` (same judge for both arms).

## Metrics
- **Primary:** agent turns per section (effort).
- **Guardrail:** gate pass rate (must not drop).
- **Secondary:** wall-clock latency, est. cost (list price), number of timeline entries, mentions of the targeted friction in the agent's report, clef-flash p(pass) on `overall` and `motion`.

## Decision rule (fixed in advance)
**Accept** the treatment if *all* of these hold:
1. median turns B ≤ median turns A
2. the gate-pass paired-bootstrap interval for B − A does not lie entirely below 0
3. targeted-friction mentions B < A

Otherwise **reject** or **iterate**.

## Caveats (also fixed in advance)
- n = 7 pairs with 1 trial each. Intervals will be wide and the results are directional. A positive result justifies keeping the feature, not a claim about effect size.
- Agents are nondeterministic, so case-level differences include run-to-run noise.
- The judge is not yet aligned with human labels, so its scores are reported but are not part of the decision.

---

## Results (2026-10-10)

Runs: `exp001-A-baseline` and `exp001-B-treatment`. Full table in [001-results.md](001-results.md) (`anim eval compare exp001-A-baseline exp001-B-treatment`).

| metric (B − A, 7 paired cases) | A | B | mean diff | 95% CI |
|---|---|---|---|---|
| turns (primary) | 24 | 19 | −5.1 | [−10.0, −1.6] |
| gate pass (guardrail) | 7/7 | 7/7 | 0 | [0, 0] |
| est. cost / section | $1.04 | $0.80 | −$0.17 | [−$0.22, −$0.12] |
| timeline entries | 17 | 11 | −6.3 | [−10.6, −3.0] |
| latency | 156s | 139s | −6s | [−19, +5] |
| judge p(overall), clef-flash | 0.55 | 0.56 | +0.01 | [−0.02, +0.04] |
| targeted friction mentions | 9 | 3 | −6 | – |

**Adoption:** all 7 treatment agents used list targets. Transformers s2 drew its attention arcs as 27 `bend` arrows and 0 hand-written paths (baseline: 28 paths). Kubernetes s3 used a bent arrow too.

**Decision: ACCEPT** (all three pre-registered conditions held). Changes ported to the main repo; all videos lint clean, and the treatment outputs regrade 7/7 under the main engine.

### Honest caveats
- n = 7, 1 trial per arm. The turns and cost intervals exclude 0, but with this n the effect size is uncertain. "About 5 fewer turns and about 16% lower est. cost per section" is the best current estimate, not a settled number.
- The judge isn't aligned with human labels yet, so "no quality change" means only that a frozen, unvalidated judge saw no difference.
- "Targeted friction" is counted with a keyword regex. Of B's 3 hits, none repeats the original complaints: one asks how glob order works, one wants per-item `from` for `fly-from` on a list, and one is about writing 21 arc objects by hand. That last one is a **repeat/array** problem, not a curve problem.

### What it points to next (candidates for experiment 002)
- **Repeat/grid primitive:** 3 of 7 treatment agents hand-wrote 21–147 near-identical objects (container grids, embedding bars, attention arcs). This is now the top friction.
- `fly-from` from an anchor (`"k8s.bottom"`), and per-item `from` for list targets.
- Entrance presets that respect an object's base opacity (agents hard-coded dim hex colours).
- A lint warning when a child's entrance is hidden by its parent group's opacity, and seam errors for not-yet-written sections reported as "pending" rather than errors.
