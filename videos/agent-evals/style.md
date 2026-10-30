# Style guide: Evaluating AI agents

**Look: Flight recorder.** One agent run unspools as a trace tape; each step gets scored.

**Format:** landscape 1920 × 1080 for slides or a doc, watched with sound. The narration carries the explanation; each section still has one short title (≤ 6 words) so a paused frame reads on its own.

**Mood:** calm, exact, a little forensic. An investigator replaying a flight recorder, not a sci-fi cockpit.

**Visual language**
- The hero is the **trace tape**: a long horizontal strip across the middle of the frame, made of step cells in order (the user's request, then LLM and tool steps, then the final answer). Each cell has a small step label in mono (`plan`, `search_flights`, `book_flight` …) and an empty score light above it. Every section reads, marks or brackets the same tape.
- The example run is the guide's own: a flight-booking agent asked "Book the cheapest flight NYC → LA for tomorrow". Mock data is labelled "example", small and grey.
- Colours mean one thing each:
  - `tape` amber = the recording itself: the tape's edge, the playhead, the run's steps as they're recorded.
  - `score` teal = a step that was scored and passed (a lit score light, a bracket that grades).
  - `fault` red = the step where it went wrong. Rare: one cell at a time.
  - `text` for words; `muted` for labels and "example"; `surface`/`line` for cells.
- Text is sparse: the section title, step labels, metric names in mono (`PlanQualityMetric`), never sentences.

**Motion personality**
- Steady and mechanical, like tape moving through a reader: the tape `wipe`s or slides in from the left at an even pace; cells `rise-in`; score lights `pop` small; brackets `draw-on`.
- The playhead (a thin amber vertical line) moves along the tape when the narration walks through the run.
- Zooming in on one step is a walkthrough beat: `focus` the camera on it, hold 1.4–2.2 s, `spotlight` dims the rest, a `chip` names it (docs/motion.md §7).
- Nothing bounces; product-like UI only eases.

**Don'ts:** no logos (no OpenAI, DeepEval or Confident AI marks drawn); no invented scores or percentages; no code blocks longer than one line; the source is credited on the end card.
