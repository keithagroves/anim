# Style guide: Decision models

**Look: Fill the form.** The question is a printed form; probability fills each answer box like ink.

**Mood:** calm, exact, a little dry. A well-made form being filled in, not a sci-fi brain.

**Visual language**
- The hero is the **form**: a dark paper card (`paper` fill, `line` stroke) with a question at the top and one row per allowed answer. Each row has a label, an empty box, and an ink bar that fills the box to the answer's probability, with the percentage beside it.
- The **state** (the input) is a second, plainer card on the left: a support ticket, written in `mono`.
- Colours mean one thing each:
  - `decide` violet = the decision model and its ink. Bars, the "one pass" sweep, the model's card.
  - `write` amber = generated text: tokens a chat model writes one at a time. It only appears where the narration talks about writing.
  - `bad` red appears once: the failed parse in the opening.
  - `text` / `muted` for words; `line` for rules and empty boxes.
- Text is sparse: labels and at most one short caption at a time. No more than ~6 words of free text at once, except the ticket.

**Motion personality**
- Precise and unhurried. Cards `rise-in`; rules and boxes `draw-on`; words `words-in`.
- Ink fills, it never pops: bars grow left to right (`grow` / `to` on `w`), percentages `count-up` with them.
- The decision happens **all at once**: every bar fills together in one pass, in contrast to amber tokens arriving one by one.
- Held cards `breathe` gently. Form UI (rows, boxes, bars) never bounces; only the model's card may `pop`.

**Don'ts:** no logos, brand marks or product UIs (company names as plain text are fine); no invented numbers (probabilities shown are examples, and the narration says so by showing them on a sample ticket).
