# Experiment 002 results: `exp002-A-baseline` (A) vs `exp002-B-treatment` (B)

7 paired cases, judge `decision:clef-flash`, rubric v2, both arms regraded and rendered by the current engine.

| case | gate A | gate B | turns A | turns B | cost A | cost B | house warnings A | B | p(motion) A | B | p(overall) A | B | new vocabulary in B |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| kubernetes-01-what-is-k8s-s1 | ✅ | ✅ | 16 | 41 | $0.81 | $1.44 | 1 | 0 | 0.38 | 0.41 | 0.29 | 0.27 | words-in, breathe, wobble, clear, time-grammar |
| kubernetes-01-what-is-k8s-s2 | ✅ | ✅ | 13 | 18 | $0.38 | $0.51 | 0 | 0 | 0.74 | 0.63 | 0.63 | 0.57 | breathe, clear, time-grammar |
| kubernetes-01-what-is-k8s-s3 | ✅ | ✅ | 18 | 28 | $0.54 | $0.72 | 1 | 0 | 0.26 | 0.47 | 0.26 | 0.42 | words-in, breathe |
| transformers-01-transformers-s1 | ✅ | ✅ | 13 | 23 | $0.43 | $0.78 | 1 | 0 | 0.35 | 0.35 | 0.37 | 0.28 | words-in, breathe, clear, time-grammar |
| transformers-01-transformers-s2 | ✅ | ✅ | 37 | 25 | $1.05 | $0.92 | 0 | 0 | 0.55 | 0.51 | 0.63 | 0.63 | words-in, clear, time-grammar |
| transformers-01-transformers-s3 | ✅ | ✅ | 29 | 19 | $0.73 | $0.69 | 0 | 0 | 0.67 | 0.58 | 0.62 | 0.55 | breathe, clear, time-grammar |
| transformers-01-transformers-s4 | ✅ | ✅ | 34 | 18 | $0.95 | $0.74 | 2 | 0 | 0.35 | 0.23 | 0.70 | 0.68 | words-in, breathe |

## Summary (B − A, paired bootstrap over cases)

| metric | median A | median B | mean diff | 95% CI |
|---|---|---|---|---|
| judge p(motion) | 0.38 | 0.47 | -0.02 | [-0.09, 0.07] |
| judge p(overall) | 0.62 | 0.55 | -0.02 | [-0.06, 0.05] |
| judge p(focus) | 0.71 | 0.72 | 0.00 | [-0.01, 0.02] |
| gate pass | 1.00 | 1.00 | 0.00 | [0.00, 0.00] |
| turns | 18.0 | 23.0 | 1.7 | [-8.1, 12.1] |
| house-number warnings | 1.0 | 0.0 | -0.7 | [-1.3, -0.3] |
| est. cost ($) | 0.73 | 0.74 | 0.13 | [-0.06, 0.34] |
| latency (s) | 132 | 123 | 25 | [-18, 73] |
| timeline entries | 12.0 | 15.0 | 1.6 | [-0.6, 3.6] |

House-number warnings by rule (A → B): thumbnail 2 → 0 · end-hold 1 → 0 · snap-off 0 → 0 · no-beat 0 → 0 · dead-air 0 → 0 · small-text 0 → 0 · ui-bounce 0 → 0 · busy 2 → 0

New vocabulary used by B's agents: words-in (5/7), breathe (6/7), wobble (1/7), clear (5/7), time-grammar (5/7).

## Decision rule (pre-registered)

1. gate-pass interval for B − A not entirely below 0: ✅ ([0.00, 0.00])
2. median turns B ≤ 1.1 × A: ❌ (23 vs 18)
3. house-number warnings B < A: ✅ (0 vs 5)
4. mean p(motion) B − A ≥ 0: ❌ (-0.019)

**Verdict: REJECT** (n=7, 1 trial each: directional, not an effect-size claim).

## Reading it

**The rule says reject.** Two of the four pre-registered conditions failed: median turns rose from 18 to 23 (the guardrail allowed 19.8), and mean judge p(`motion`) fell by 0.02 (interval −0.09 to 0.07, so no detectable change either way).

**The turns increase looks real, not noise.** The baseline system ran twice with the same prompt, engine and docs (exp001's arm B and this arm A), and its median was 19 and 18. B's 23 sits above both. Cost moved less: total $4.90 for A and $5.81 for B.

**The agents did what the house numbers ask.** Every house-number warning in the agents' own sections went away (5 → 0: `thumbnail` 2 → 0, `end-hold` 1 → 0, `busy` 2 → 0). They used the new vocabulary without being told which section needed what: `breathe` in 6 of 7 sections, `words-in` and `clear` in 5, pre-roll times in 5. The judge didn't reward any of it, which the pre-registration expected: it sees frames 0.5 s apart, where overshoot, breathing and word stagger are mostly invisible.

**Where the extra turns went.** B's friction reports name three bugs in the new features and two older engine bugs. Each one cost a lint round and a workaround:

| bug | hit by | fixed after the experiment |
|---|---|---|
| `clear`'s 0.06 s default stagger over 17–38 local objects overran the section end (`boundary-spill`, `local-spill`) | 3 of 7 B agents | the default now fits the whole set into ~0.25 s |
| `words-out` was flagged `snap-off`: the rule ignored per-word visibility | 2 of 7 | `snap-off` counts a word-by-word text as visible as its most visible word |
| `end-hold` read as "no beats in the last 3 s" of every section, leaving spoken words with no picture | 1 of 7 | `docs/motion.md` now says it is only for the video's last section, and the last beat lands *on* the last line |
| `highlight` set the stroke at the section's t=0, before it started (a seam error on shared objects) | 1 of 7 (and the ph-test trace) | it changes nothing outside its own window; no pixel of any existing video changes |
| a layout group inside a layout group never laid out its own children, so grids had to be written cell by cell with `dx`/`dy` | 1 of 7 (the 41-turn case: 147 hand-placed cells) | layout groups nest; a `col` group of `row` groups is a grid |

None of these fixes was in the tested B. They are in the repo now.

## Decision

**Rejected as tested.** The treatment is still in the repo (engine, lint, docs and prompt), on the reasoning that all five problems behind the extra turns are now addressed (four in code, one in the docs) and the agents followed the rules. Whether to keep it until a re-test is the owner's call. Restoring the old agent behaviour takes two edits: remove the `docs/motion.md` line and the two motion rules from `evals/prompts/section-agent.md`, and remove "Read `docs/motion.md`" from step 1 of the workflow in `docs/format.md`.

## Next

Experiment 003: the same design against the fixed engine, with **3 trials per case** (42 runs, about $35) so a 5-turn difference can be told from run-to-run noise. Pre-register it before running. Keep the judge as a "not worse" check only, until it has human labels for `motion`.
