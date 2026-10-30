# Experiment 002: Do the house numbers make section agents move things better?

*Pre-registered 2026-10-21, before any treatment results were seen.*

## Background
Claude Motion's craft rules (see `notes/plan-motion.md`) are numbers learned from review: held things breathe, shapes overshoot and UI only eases, words enter one at a time, frame 0 is the thumbnail, the last picture holds 3 s, every section clears itself. Our engine had no vocabulary for most of them, and our agents were told none of them. On 2026-10-21 the new lint rules found that 9 of our 10 videos open on an empty backdrop and 8 of 10 end without a 3-second hold.

## Hypothesis
Giving section agents the vocabulary (tunable `pop`, `breathe`, `sway`, `wobble`, `words-in`, `clear`, `anticipate`, the time grammar with pre-roll) **and** the numbers (`docs/motion.md`, read from the prompt) makes their motion better, as judged on the contact sheet, without costing correctness or much effort.

## Design
- **Cases:** the 7 gold cases (3 Kubernetes and 4 transformers sections), as in exp001.
- **Arms:**
  - A = the repo as it was before this work: engine, `docs/format.md`, section-agent prompt (backup taken 2026-10-21 05:03, before any change).
  - B = the current engine, `docs/format.md`, `docs/motion.md` and section-agent prompt.
  - Same SUT runner, model and settings. 1 trial per case per arm = 14 runs.
- A runs in an isolated copy of the old repo; B runs in this repo. Both concurrently, concurrency 2 each, $15 cap per arm.
- **Grading, the same for both arms, afterwards:** `anim eval regrade` with the *current* engine and linter (so both arms are measured by the same rules), then the local judge `decision:clef-flash` with rubric v2. Both arms' outputs are rendered by the current engine (A uses only presets that exist in both; `pop` lands slightly differently).

## Metrics
- **Primary (judge):** mean judge p(pass) on `motion`, paired by case.
- **Primary (deterministic):** house-number warnings in the agent's own section, summed over cases: `thumbnail`, `end-hold`, `snap-off`, `no-beat`, `dead-air`, `small-text`, `ui-bounce`, `busy`.
- **Guardrails:** gate pass rate must not drop; median turns must not rise more than 10 %.
- **Secondary:** p(`overall`), p(`focus`), cost, latency, timeline entries, use of the new presets in B, friction mentions.

## Decision rule (fixed in advance)
**Accept** B if all of these hold:
1. the gate-pass paired-bootstrap interval for B − A does not lie entirely below 0
2. median turns B ≤ 1.1 × median turns A
3. house-number warnings B < A
4. mean p(`motion`) B − A ≥ 0

**Iterate** if 1–3 hold and 4 fails (the agents follow the rules, but the judge doesn't see better motion: check the judge or the rules). **Reject** if 1 or 2 fails.

## Caveats (also fixed in advance)
- n = 7 pairs with 1 trial each. The result is directional, not an effect size.
- The judge has never been aligned with human labels (there are none yet). Its scores are part of this decision only as a "not worse" check (rule 4 asks for ≥ 0, not for a significant gain).
- The judge sees contact sheets at 0.5 s steps. Motion between samples (overshoot, breathing, word stagger) is mostly invisible to it, so the judge is a weak instrument for exactly this hypothesis.
- B changes docs, prompt and engine at once, so a positive result can't say which part helped.
- Arm A's sections render with the current `pop`, which A's agents never saw.
