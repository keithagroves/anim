# Style guide: How the evals improve the tool

**Mood:** a calm, honest engineering explainer. A whiteboard walk-through by someone who trusts the numbers but shows their uncertainty. Not a marketing reel.

**Visual language**
- Boxes are dark rounded cards (`card` fill) with a coloured edge. The edge colour says what kind of thing it is, and each colour means one thing only:
  - `gold` amber: the gold set, i.e. frozen test cases (small stacked cards).
  - `agent` violet: AI section agents (they write the scenes).
  - `gate` blue: deterministic checks (compile, lint, seams). Pass is a `good` tick, fail is a `bad` cross.
  - `judge` green: the local judge model (free, runs on this machine).
  - `human` pink: people labelling outputs.
- Flow goes left → right with arrows that `draw-on`. Use curved arrows (`bend`) for loops and feedback.
- Numbers are real and few: 24 → 19 turns, −16% cost, 7/7 gate. Use `count-up` for them.
- Text is sparse: one short title per idea ("gold set", "harness", "trust", "experiment 001", "the loop") plus short box labels. The narration carries the explanation. No more than ~6 words of free text on screen at once (box labels don't count).

**Motion personality**
- Unhurried and precise: `rise-in`, `draw-on`, `pop`, `type-on`, `fade-in`. Nothing spins or bounces for decoration.
- Show cause and effect: arrows grow from the thing that acts to the thing it acts on.
- Land beats on narration cues. Keep gentle motion between beats; no dead air.
- Stagger similar things (0.05–0.12s).

**Don'ts**
- No logos, brand names or product UIs.
- Don't invent statistics beyond the ones in the narration.
