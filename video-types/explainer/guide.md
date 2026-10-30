# Narrated explainer: what works

**Shape.** Hook (a question or a tension) → one idea per section → payoff. 3–5 sections of 10–15 s. Each section is written by its own agent, in parallel, against a contract.

**One hero metaphor, kept on screen.** Every good explainer so far had one recurring set of shared objects that the sections transform:
- the Kubernetes cluster
- the seven token chips ("The cat sat because it was tired")
- the gold-set card stack

Shared objects plus `keys` are what make independently written sections feel like one film. Put the hero in `scene.json`; agents only add local, temporary objects around it.

**Briefs are the main lever.** A good brief names the cue for each beat, the exact objects to use, and the key to end on: "At cue:kappa, a bar filling to a threshold labelled 'κ ≥ 0.6 → trusted'." A vague brief ("show attention") produces a generic section. Give real numbers and forbid invented ones.

**Pick a stage, don't inherit one.** Every explainer up to deepresearcheval used the default `dots` backdrop, so they all looked alike. Choose a preset that fits the subject (`anim sheet <video> --scene <id> --backdrops` shows them all on a real frame), and colour any glows with the video's own tokens. See docs/theme.md.

**Narration first.** Picture timing comes from the voice: Kokoro word times give the cues, and section boundaries snap to pauses. Write cues on the exact word the picture should land on. Keep it to about 150–180 wpm and ≤ 6 words of on-screen text at once.

**Motion has numbers.** `docs/motion.md` holds them: held shapes breathe, shapes overshoot and UI only eases, words enter one at a time (`words-in`), frame 0 is the thumbnail (pre-roll the first line with `"at": "start-0.5"`), the end holds ≥ 3 s, and every non-final section ends with `clear`. Lint checks most of them.

**Review loop.** Run `anim lint` (seams, spill, dead air, overlaps), then read `anim sheet` per section. Every generation is traced and judged by the local judge. If a section misses, regenerate it rather than hand-patching it, and its trace feeds the evals.

**Pitfalls seen:**
- Globs that also match child objects: use list targets.
- Hand-drawn arcs: use `bend`.
- 20+ near-identical objects written by hand: no repeat primitive yet.
- `highlight` flashes the stroke only: an object with no stroke shows nothing. Tween `fill` with `to` and back instead (ph-test trace, 2026-10-21).
- The last section has the least time to land its payoff.
- Root objects paint in declaration order: a shared label declared before the group of the box it sits on is hidden under the box, and lint doesn't catch it. Give it `"layer": 1` (cordis `ctxLabel2`).
- A second entrance preset on an object that already appeared hides it from the section start until that entrance runs. To bring something back after an exit, use `to: { opacity: 1 }`.
- `dash` can't be animated: crossfade to a second, dashed copy (cordis `s2.broken`).
- `fly-from` starts from the source object's centre, so chips flying out of a card overlap its label for a moment (harmless `overlap` warnings).
