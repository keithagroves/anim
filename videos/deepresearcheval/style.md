# Style guide: How do you grade a deep research agent?

**Mood:** a calm, honest paper explainer (DeepResearchEval, Wang et al., 2026). A whiteboard walk-through by someone who respects the numbers. Not a marketing reel.

**Visual language**
- The hero is the pipeline on the left third: a `task` card (amber) → the `agentArrow` ("deep research agent") → the `report` document (blue edge, with three segments of text lines). Every section evaluates this report from the right two-thirds of the stage, which is the workspace.
- Boxes are dark rounded cards (`card` fill) with a coloured edge. Each colour means one thing only:
  - `task` amber: research tasks, personas, anything that comes from the task (including task-specific dimensions).
  - `report` blue: the report and the agents that write it.
  - `judge` violet: the quality judge and the general dimensions.
  - `checker` cyan: the fact-checking agent and its web searches.
  - `good` green = Right · `bad` red = Wrong · `muted` grey = Unknown. Also green tick / red cross for pass/fail.
- Flow goes left → right; arrows `draw-on` from the thing that acts to the thing it acts on. Use `bend` for curves.
- Numbers are real and come from the paper only (listed in each brief). Use `count-up` for headline numbers. Never invent weights, scores or percentages.
- Text is sparse: one short section title per idea (h2, top of the workspace, e.g. "1 · tasks") plus short labels. No more than ~6 words of free text at once (labels and chart axes don't count).
- Model / system names appear as plain text labels in charts only. No logos.

**Motion personality**
- Unhurried and precise: `rise-in`, `draw-on`, `pop`, `type-on`, `wipe-in` for bars. Nothing spins or bounces for decoration.
- Land beats on narration cues; stagger similar things (0.05–0.12 s); keep gentle motion between beats; no dead air.

**Don'ts:** no logos or product UIs; no invented numbers; nothing over the hero on the left third unless the brief says so.
