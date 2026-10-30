# Style guide: Neural networks are already clean

Explains Nick Cammarata's essay "Neural Networks Are Already Clean" (Goodfire, a working hypothesis).

**Look: Microscope slide.** Neurons as specimens under a round lens, lit from below, slow focus pulls. The whole film is a look down a microscope: the essay's thesis is "same neurons, better microscope".

**Mood:** a calm lab bench. A researcher re-examining old slides and finding they were misread. Curious, careful, never triumphant or mocking: the author proposed the old idea too.

**Visual language**
- The hero is the `scope`: a large round field of view (a thin reticle ring with tick marks and a faint crosshair) and the `cell` inside it, one neuron drawn as a soft cyan cell body with a nucleus. Sections put their specimens inside the lens, or pull the lens aside to lay out evidence beside it.
- Colours mean one thing each:
  - `cell` cyan: neurons and what they really respond to. `cellDim` for neurons not yet understood / unlit.
  - `fix` amber: the corrected reading, the thing the essay says is really going on ("V shape", "shared pose", "recursive generalization"). Use it once per beat, for the answer.
  - `old` rose: the old reading, struck through or faded: "cat + car", "superposition", the knot.
  - `text` white for words, `muted` for captions and credits.
- Specimen labels are small chips (dark `card` fill, thin edge) like slide labels. Titles are lowercase h2, top of the frame.
- Real numbers only, from the essay: 99–100%, ~1.7%, ~90 / ~7 / 2–4%, 7.06M parameters. Never invent percentages, neuron counts or model names.
- At most ~6 words of free text on screen at once; the narration explains.

**Motion personality**
- Unhurried and precise, like adjusting a microscope. Focus pulls: things come into view by `scale-in` + `fade-in` (a blur-to-sharp feel), labels `words-in`.
- The cell `breathe`s whenever it is held. Shapes land with a gentle `pop` (overshoot ≤ 1.5); the old reading leaves by fading and sinking, the new one lands and stays.
- Cause and effect: arrows draw from the neuron to what it reads or writes.
- One subject at a time; every non-final section ends with `clear`.

**Don'ts:** no logos (Goodfire, OpenAI, Anthropic, Qwen are text only); no photos or photo-real images (draw specimens as simple shapes and glyphs); no invented numbers; nothing that mocks the old view.
