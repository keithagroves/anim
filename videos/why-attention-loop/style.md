# Style guide: Why attention won (15 s loop)

**Look: Three lanes, two counters.** RNN, CNN and self-attention over the same eight inputs; each lane counts its steps in a row and its hops from the first word to the last.

**Format:** 1920 × 1080, silent, seamless 15 s loop for a presentation. Closes the series (same palette, same caption list on the left).

**Colours:** `state` amber = RNN (as in rnn-loop); `input` blue = CNN; `output` green = self-attention; `line`/`surface` for structure.

**Truth:** the comparison is the paper's Table 1 (sequential operations O(n) / O(1) / O(1); maximum path length O(n) / O(n/k), O(log_k n) dilated / O(1); self-attention costs O(n²·d) per layer). The counts are for an eight-word example with kernel width 3, labelled so.
