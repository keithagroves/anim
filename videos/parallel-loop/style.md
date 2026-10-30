# Style guide: What makes it parallel (15 s loop)

**Look: One matrix, then a staircase.** The decoder's attention matrix fills in a single step; a mask blacks out the upper triangle; training lights every row at once, generation unlocks one row at a time.

**Format:** 1920 × 1080, silent, seamless 15 s loop for a presentation. Sits after why-attention-loop in the series (same palette, same caption list on the left).

**Colours:** `gate` lavender = attention weights; `state` amber = the RNN strip (as in rnn-loop); `output` green = predictions; `line`/`surface` for structure; masked cells near-background with a hatch.

**Truth:** masked self-attention, shifted-right inputs and teacher forcing in training, autoregressive decoding at inference are the paper's (sections 3.1, 3.2.3). The weights are illustrative, labelled so.
