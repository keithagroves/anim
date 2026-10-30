# Style guide: Your AI product needs evals

**Look: Lab notebook.** Ruled pages where ink ticks and crosses tally each trace you read.

**Format:** vertical 1080 × 1920 for a social feed, watched muted more often than not. So every section carries ONE short on-screen line (≤ 6 words, `h2`, top band) that tells the story without sound; the narration adds to it. Keep anything that matters out of the bottom ~240 px (the feed's own buttons sit there).

**Mood:** practical, a little wry, unhurried. A good engineer's notebook, not a dashboard.

**Visual language**
- The hero is the **page**: a white notebook card of example traces (one user request per ruled row) with an empty mark circle at the end of each row. Every level of evals marks the same page in its own way.
- Colours mean one thing each:
  - `pass` green = a trace that's good (a tick, a filled green mark).
  - `fail` red = a trace that's bad (a cross, a red mark). Used sparingly: one or two rows at a time.
  - `text` ink for words and hand marks; `muted` for labels; `line` for rules.
- Text is sparse: the one headline per section, short labels, mono for trace text and code.
- Mock data is labelled: anything that looks like a real tool says "example" or "Concept mock", small and grey.

**Motion personality**
- Calm and exact. Cards `rise-in`; rules `draw-on`; headlines `words-in`. Marks land like pen strokes: ticks and crosses `draw-on` quickly (0.25–0.35 s), staggered down the page (0.1–0.15 s).
- The page is held and breathes gently; product-like UI (the viewer) only eases, never bounces.
- The viewer section is a walkthrough: the camera `focus`es on one region at a time, holds 1.4–2.2 s, a `spotlight` dims the rest, a `chip` names the thing (docs/motion.md §7).

**Don'ts:** no logos or real product UIs (no Rechat, LangSmith or other brands drawn); no invented numbers or percentages; the source is credited on the end card.
