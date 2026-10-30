# Style guide: Transformer (15 s loop)

**Look: Figure 1, redrawn.** The encoder–decoder diagram from "Attention Is All You Need", one translation step flowing through it.

**Format:** 1920 × 1080, silent, for a presentation slide; a seamless 15 s loop (the last frame is the first). Companion to videos/rnn-loop (same palette).

**Colours:** `attn` amber = attention; `ff` blue = feed forward; `norm` lavender = add & norm; `embed` pink = embeddings; `output` green = linear, softmax and the predicted word; `input` blue = input tokens.

**Motion:** each block glows as the signal passes through it, bottom to top, encoder then decoder; the cross-attention arrow draws on; the predicted word feeds back into the decoder's input; everything resets together.
