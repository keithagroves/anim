# Style guide: Convolutional neural network (15 s loop)

**Look: The scan.** A 3×3 filter slides over a handwritten digit and writes a feature map, cell by cell.

**Format:** 1920 × 1080, silent, seamless 15 s loop for a presentation. Companion to rnn-loop, transformer-loop and lstm-loop (same palette, same caption list on the left).

**Colours:** `text` = image pixels; `state` amber = the filter and feature values; `gate` lavender = pooled maps; `output` green = the predicted class.

**Truth:** the first feature map is the real convolution of the digit with the filter shown (horizontal-line detector, ReLU); the other maps use a vertical, a diagonal and a blur filter; pooling is a real 2×2 max-pool. Class scores are an example.
