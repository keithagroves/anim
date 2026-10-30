# Style guide: LSTM (15 s loop)

**Look: The memory line.** One LSTM cell in the standard textbook layout, its gates lit one at a time.

**Format:** 1920 × 1080, silent, seamless 15 s loop for a presentation. Part of the pre-transformer series with rnn-loop and cnn-loop, then transformer-loop (same palette, same caption list on the left).

**Colours:** `state` amber = the cell state c (long-term memory); `input` blue = hₜ₋₁ and xₜ coming in; `gate` lavender = σ gates (0–1, how open); `cand` pink = tanh candidate values; `output` green = hₜ out.
