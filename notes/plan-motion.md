# Plan: what Claude Motion taught us, applied to `anim`

Source: three Claude Motion films, studied on 2026-10-11, and Motion's craft guidance. Written 2026-10-21.

## Status (2026-10-21)

Executed. What shipped, by workstream:

| item | state | where |
|---|---|---|
| A1 tunable overshoot, `spring`, new `pop` | done | `src/engine/ease.ts`, `presets.ts` |
| A2 `breathe`, `sway`, `creep` | done (opt-in, see open question 1) | `presets.ts` |
| A3 `words-in/out`, `lines-in/out` | done, no text measurement needed (nested tspans with compensated offsets) | `presets.ts`, `paint.ts` |
| A4 `anticipate`, `wobble`; "settle" is `ease: "spring"` | done | `presets.ts` |
| A5 `clear` | done | `presets.ts`, `compile.ts` |
| A6 `ui: true`, `ui-bounce` | done | `types.ts`, `lint.ts` |
| B time grammar + pre-roll | done (its own parser in `timing.ts`; the score keeps its beat-aware one) | `timing.ts`, `compile.ts` |
| C house-number lint | done: `thumbnail`, `end-hold`, `open-calm`, `small-text`, `snap-off`, `flash` (error), `raw-color`, `raw-pixels`, `no-beat`, `ui-bounce`, `scene-exit` | `lint.ts` |
| D1–D3 `docs/motion.md`, prompt, rubric v2, worked example | done | `docs/motion.md`, `evals/prompts/section-agent.md`, `evals/rubric.json` |
| D4 rule proposals | done: `anim monitor propose <analysis> --kind rule`; accepting writes the line into `docs/motion.md` | `src/evals/monitor.ts` |
| D5 looks | done as docs and a first step in every video type; not interactive | `docs/looks.md`, `video-types/*/type.json` |
| E1 placeholders | done | `compile.ts`, `lint.ts` |
| E2 section marks by state | done | `player.ts`, `server.ts` |
| E3 `anim gen scene` | done, verified on one real section ($0.70) | `src/cli/eval.ts` |
| E4 rough sketch stage | done as a storyboard: a `sketch` per section (96 × 54 paths in palette roles), `anim plan` renders the storyboard, placeholders draw the sketch in rough black and white | `src/engine/sketch.ts`, `src/cli/plan.ts`, `compile.ts`, `docs/format.md` |
| I walkthrough numbers (added 2026-10-21) | done: `focus` camera preset (log-space zoom, ease `arrive`/`glide`), `spotlight` and `chip` objects, lint `focus-zoom`, `focus-hold`, `camera-speed`, `chip-words`, `chip-time`, `chip-over`; `docs/motion.md` §7, product-tour guide | `presets.ts`, `ease.ts`, `paint.ts`, `layout.ts`, `lint.ts` |
| J length and where-watched questions | done as docs (`docs/looks.md` §4) and the explainer's first step | `docs/looks.md`, `video-types/explainer/type.json` |
| F judge pins | done for the Claude judge, shown in the labelling UI and outlined in the player | `judge.ts`, `label.ts`, `player.ts` |
| G score arc, silent ambient presets | done | `docs/score.md` |
| H scene exits | done as the `scene-exit` warning | `lint.ts` |
| Experiment 002 | **rejected as tested** (pre-registered rule): median turns 18 → 23 and judge p(motion) −0.02, while house-number warnings went 5 → 0 and agents used the new vocabulary in most sections. The five bugs the agents hit are fixed since; a 3-trial re-test (exp003) is next | `experiments/002-results.md` |

Open questions, as decided:
1. **Hold motion is opt-in.** `breathe` is an entry or a through track; nothing breathes by default, so existing videos render unchanged except where they use `pop`.
2. **Word layout** needed no measurement: each word is a nested `tspan` whose offset is a relative `dx`/`dy`, compensated on the next word, so the line's layout and anchor never move.
3. **`small-text` warns below 22 px** (the `small` token), not 26. Labels stay at 22 px; body text should be ≥ 28. It ignores text while it is still entering or leaving.
4. **Section exits stay per section.** `clear` covers locals; shared objects that leave at the end of a scene still need an exit in the last section.

Fixed after experiment 002, from the agents' friction reports: `clear`'s default stagger now fits ~0.25 s, `snap-off` respects word-by-word text, `highlight` no longer touches the stroke outside its window (a seam bug), nested layout groups lay out (grids), and `docs/motion.md` limits `end-hold` to the video's last section.

Changed for existing videos: the new `pop` (scale from 0.4 with a tunable overshoot, opacity done in 0.2 s) changes frames *during* pops in the 7 videos that use it; every changed frame was checked to lie inside a pop. Nothing else renders differently. Lint finds no new errors in any video; it now warns that 9 of 10 open on a bare backdrop and 8 of 10 end without a 3 s hold.

## 0. Where we stand

`anim` already has what Motion's *architecture* buys: `evaluate(scene, t)` is pure, scenes and sections are separate files with local time, the preview reloads on every write, the score is event data on the picture's timeline, and every generation is traced and judged. On the contract side (keys, seams, lint, cues from the voice, pre-registered experiments) we are ahead of Motion.

Where we are behind is the **craft layer**, and the research is specific about it:

| Motion has | `anim` today |
|---|---|
| Everything is always in motion: held shapes breathe ±1–2 % on a ~3 s sine, holds drift, titles creep | `drift` on the camera only. A held frame is static, and `dead-air` tells agents to add *beats*, which is the wrong fix |
| Overshoot on shapes (`eob` 1.4–1.9, 1.5 for pills), never on UI | One fixed `back` ease (1.70158). No way to tune it, nothing stops it on UI |
| Pop-in recipe: opacity done in ~0.2 s, scale from 0.4, un-rotate from −30°, then breathe | `pop` scales from 0 with a snappier fade, no rotation, then freezes |
| Type enters word by word, one direction, 110 ms stagger, 24–34 px drift; exits quicker the other way | Whole-line fade/rise, or character `type-on` |
| Anticipation, settle, decaying wobble after landing, arcs | `shake` (horizontal, decaying) only |
| Every scene clears itself over its last ~0.6 s, rows peel off staggered | Locals must be gone by the section end, so agents write one exit per object or let things vanish |
| Frame 0 is the thumbnail: the first line is already readable at t = 0 (entrance starts at −0.5 s) | Entrances hide their object until they start, so frame 0 is backdrop only |
| Title ~2.5 s, one 1.2–1.5 s push, end card held ≥ 3 s, nothing flashes > 3/s | Not checked, not documented |
| Craft rules are *numbers* in the prompt, each one shipped once and sent back | `docs/format.md` has a one-line rubric; the numbers live in nobody's head |
| The user watches the film fill in: unwritten scenes show a name card | A missing section file is a compile error, so nothing shows until every agent is done |

Nearly every scene in all three Motion films used a handful of moves: eases, overshoot, breathing and word-by-word text. Of those, `anim` is missing breathing, tunable overshoot and word-by-word text. That is the core of this plan.

## 1. Principles we take

1. **Always moving, one thing at a time.** Hold motion is ambient and cheap; beats are rare and staggered 200–400 ms. Arrivals ease out, exits ease in, repositioning eases in-out. Shapes overshoot; UI only eases.
2. **Numbers, not adjectives.** Every craft rule the agent sees is a range with a unit, and each one traces back to a review that failed without it.
3. **Frame 0 and the last 3 s are the two frames people judge first.** Treat them as contract, like seams.
4. **The user watches it build.** Partial output is a product state, not an error.
5. **Keep the structured format.** Motion lets Claude write arbitrary JS; our format is what makes lint, seams, patches and the eval harness possible. We add vocabulary to it rather than opening it up.

## 2. Workstreams

Each item says what changes, where, and how we know it helped. Engine and lint changes are measured for free with `anim eval regrade`; prompt and docs changes need an `anim eval run` on the gold set.

### A. Motion vocabulary (`src/engine/presets.ts`, `ease.ts`, `paint.ts`)

| # | Change | Detail |
|---|---|---|
| A1 | Tunable overshoot | `ease: "back"` takes `overshoot` (default 1.7, range 1.2–2.0). Add `spring` (damped, settles in `dur`). `pop` default moves to the research recipe: opacity in the first 0.2 s, scale 0.4 → 1 with overshoot 1.7, optional `rotate` from −30°. |
| A2 | Hold motion | New loop presets: `breathe` (scale ±`amount` 0.012 on a `period` 3 s sine, phase offset per target so a stagger list doesn't pulse in unison), `wobble` (rotation, same shape), `creep` (translate `amount` px/s). All accept `dur: "all"` as through tracks and also work as section entries. |
| A3 | Words in motion | `words-in` / `words-out`: the text splits into words at paint time, each word fades and drifts `distance` (28 px) from one `from` side with `stagger` (0.11 s); exits run faster the other way. Also `lines-in` for multi-line text. The text stays **one string** in the file, as Motion insists, so retiming and retyping stay one edit. |
| A4 | Lifelike moves | `anticipate` (default 0.04, ~120 ms dip the other way) on `to`, `move`, `fly-from`; `settle` (a short `spring` tail) on arrivals; `shake` gains `mode: "rotate"` with degrees, so the decaying attention-shake recipe is one entry. |
| A5 | Scene clears itself | A `clear` entry: `{ "preset": "clear", "at": "end-0.6", "stagger": 0.06 }` sinks every local object out, staggered in declaration order, finishing before the section end. Replaces N hand-written exits. |
| A6 | UI only eases | Objects can be tagged `ui: true` (video objects are implicitly). Overshoot, spring, squash or wobble on a UI object is a lint warning (`ui-bounce`). |

Foley: the new loop presets map to `none` by default in `foley-from-picture` so ambient motion never makes sound.

### B. One time grammar (`src/engine/timing.ts`, shared with `src/score/score.ts`)

The score already parses `base[~snap][offsets]` (`cue:end~beat-1b`, `s3.end+0.5`). The picture only accepts seconds or `cue:name`. Move the parser into the engine and let section `at`/`after`/`with` use `start`, `end`, `cue:name`, `sN`, `sN.end` with `±seconds` offsets (beat snaps stay score-only). This is what A5 needs, and it lets the first section write `at: "start-0.5"` so the title is readable at frame 0.

### C. House numbers as lint (`src/engine/lint.ts`)

New rules, all warnings unless marked:

| rule | fires when |
|---|---|
| `thumbnail` | frame 0 of the first scene shows no text and no object with opacity > 0.5 (only the backdrop) |
| `end-hold` | the final picture of the last section is not held for ≥ 3 s (anything but loop presets runs in the last 3 s) |
| `open-calm` | camera scale or pan changes by more than 5 % in the first 5 s, or more than one camera move starts there |
| `small-text` | any text renders below 26 px on screen after the camera scale (theme `small` is 22 px today: raise it or reserve it for zoomed frames) |
| `snap-off` | a local object goes from visible to hidden in under 2 frames with no exit preset (it was cut, not cleared) |
| `flash` (error) | any object's opacity or fill toggles more than 3 times in one second |
| `raw-color` / `raw-pixels` | a hex colour or a `dx`/`dy` over 200 px where a token or placement would do |
| `no-beat` | split from `dead-air`: `dead-air` stays "nothing at all moves > 2.5 s"; `no-beat` is "no new beat for > 4 s while narration plays". Ambient motion (A2) satisfies `dead-air` and not `no-beat`, so agents stop adding filler beats to silence the linter |

`busy` (> 3 starts within 0.3 s) already encodes "one thing at a time" and stays.

### D. Prompt and docs: the main lever

Experiment 001 showed the biggest wins come from what the agent is told and what the format makes easy. The prompt method to follow: terse, numeric, every rule from a review, progressive disclosure, examples from another film.

| # | Change |
|---|---|
| D1 | New `docs/motion.md`, about 80 lines: the house numbers for our stage (1920 × 1080 at 30 fps). Entrances 0.35–0.6 s ease-out; exits 0.25–0.4 s ease-in; related entrances staggered 0.2–0.4 s, lists 0.05–0.12 s; words 0.11 s / 28 px; overshoot 1.4–1.9 on shapes, never on UI; hold motion ±1–2 % / 3 s; title on screen ≥ 2.5 s; establish 0.6–1 s after a cut before the next beat; end hold ≥ 3 s; display type 90–170 px, body ≥ 26 px on screen; one accent colour doing one job; new shades mixed from tokens, never new hex. Each line carries a `(crit: <case or trace>)` tag naming the review that produced it, and a line without one is a guess to be removed. |
| D2 | `evals/prompts/section-agent.md` reads `docs/motion.md` right after `docs/format.md`. `docs/format.md` gets the new presets, the time grammar and `clear`. The `motion` rubric criterion in `evals/rubric.json` cites the numbers so the judge and the agent read the same rule. |
| D3 | One worked section from a video **outside** the gold set, framed as: copy how it is built, never its objects, words, colours or times. |
| D4 | Rules from review, as a loop: `anim monitor propose` already groups failing traces. Add a proposal kind that writes a one-line rule for `docs/motion.md` with its `crit` tag, so every recurring judge fail or friction report becomes a numbered rule the way Motion's "every don't was shipped once" did. |
| D5 | Anti-sameness at the start. The explainer guide already found that every video inherited the `dots` backdrop. Extend `anim new` (and the scaffold in each `type.json`) to ask for a look the way `questions.md` does: 3–4 looks invented for *this* subject, each a 1–3 word name plus a ≤ 12-word "what's on screen, what it's made of, how it moves" line, never a stock list; palettes visually distinct at a glance. The answer becomes `style.md` and `theme.json`. |

**Experiment 002** (pre-register in `experiments/002-house-numbers.md` before any treatment run): A = today's engine, docs and prompt; B = A + `docs/motion.md` + A1, A2, A5, B. Same 7 gold cases, same judge. Primary: judge p(`motion`) and p(`overall`). Guardrails: gate pass, `busy` and `dead-air` counts don't rise, turns don't rise more than 10 %. Secondary: entries per section, `snap-off` and `thumbnail` counts (should fall to zero in B), cost. Decision rule in the same shape as exp001.

### E. Watch it build (`src/cli/load.ts`, `src/browser/player.ts`)

| # | Change |
|---|---|
| E1 | A missing section file compiles to a **placeholder**: the section id and brief as a name card in the scene's own theme, holding for the span. The scene compiles, seams on the placeholder's sides are skipped, and the preview shows the film with holes where agents are still working. |
| E2 | Section marks in the player are coloured by state: missing, written with lint errors, clean. The one-second version poll already reloads on each write. |
| E3 | `anim gen scene <video> --scene id` runs every section agent in parallel (today `gen section` is one at a time) so E1 has something to show. |
| E4 | Later: a `rough` stage that draws placeholders and unreviewed sections in a sketch style (rough.js, already in the stack plan), drawn like pencil. Only worth it once E1–E3 are in use. |

### F. Review anchoring (`src/evals/judge.ts`, `label.ts`)

Motion pins every reviewer comment to a time and a point or box (`at 12.4 s, x 42 % y 40 %`). Our judge cites frame times only. Ask the Claude judge for `at` (seconds) and an optional `box` (fractions of the frame) per critique line, store them on the trace, and let the labelling UI place a pin and jump the player there (`#t=` already works). This makes critiques patchable by position, which is the first step toward critique → JSON Patch. Low cost, do it after D.

### G. Sound (small, `docs/score.md`)

The score format is already ahead of Motion's. Two additions from the research: an **arc checklist** in the doc (quiet title → pulse → groove → build → hit on the end card on a downbeat → ring out, `revswell` into the last section, `fadeOut` 1.2–1.4 s), and the rule that ambient presets are silent (see A).

### H. Scene to scene

Motion hard-cuts between scenes and makes every scene clear itself. Multi-scene videos get the same rule for free from A5 plus a `scene-exit` warning when the last section of a non-final scene doesn't clear. Transitions and hand-offs from `plan.md` M4 stay deferred.

## 3. Sequence

| sprint | items | verified by |
|---|---|---|
| 1 | A1, A2, A5, B, C | `anim eval regrade` on `reference`, `exp001-*`: new warnings appear with sane counts, zero gate changes, every existing video still renders with the same fingerprint where untouched. Re-render `cordis` and `cpu-cache` with `breathe` + `clear` added by hand and compare contact sheets by eye |
| 2 | D1–D3, then experiment 002 | pre-registered decision rule; accept, iterate or reject the docs |
| 3 | A3, A4, A6, E1–E3 | A3 needs real word widths: check whether `layout.ts` measures text or estimates it, and add a cached Playwright measurement in `build/` if it estimates. Regrade plus one new gold case that uses `words-in` |
| 4 | D4, D5, F, G, H, E4 | monitor proposals produce rule lines; `anim new` produces distinct looks across three scaffolds |

## 4. What we deliberately don't copy

- **Free-form JS scenes.** Motion's agent writes code; ours writes data. Keep that: it is the reason lint, seams, patches and the harness exist.
- **DOM-to-canvas export rules** (no nested quotes, `data:` images only). We paint SVG in Playwright; not applicable.
- **The form widget and the scripted close.** The look questions (D5) are enough for a CLI; the canned wording is a chat product concern.
- **60 fps teasers.** `fps` is already a project setting; the default stays 30.

## 5. Open questions

1. **Hold motion by default?** Making `breathe` apply to every held shape through the theme would change every existing video's frames and fingerprints. Start opt-in (an entry or a through track that `docs/motion.md` tells agents to add), measure in experiment 002, then decide.
2. **Word layout.** `words-in` needs per-word x positions. If `layout.ts` estimates widths from character counts, words will jitter against the whole-line layout. Decide in sprint 3 whether to measure once in Playwright and cache, or ship `lines-in` first.
3. **`small` text at 22 px** breaks the 26 px floor the research gives. Raise the token, or keep it and make `small-text` a warning only when the camera isn't zoomed in.
4. **Section vs scene exits.** Motion clears per scene; we clear per section because locals die at the section end. Shared objects that should peel off at the end of the *scene* still need a hand-written exit in the last section. Fine for now; revisit if agents keep reporting it as friction.
