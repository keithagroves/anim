# Whiteboard diagram: what works

**Boxes appear when they're named.** Each box draws on at the cue of its name, then its arrows draw from cause to effect. A diagram that is all on screen at t=0 is a slide, not a video.

**Semantic layout only.** Place boxes with `rightOf`, `below` and `in` (frames), with gaps from the spacing tokens. Never use raw coordinates: then the same scene renders in the video *and* on the tldraw canvas (`anim canvas`, `--watch` for live edits).

**Arrows:**
- When two arrows meet one box, give them different anchor fractions (`canvas.left:0.3`, `canvas.left:0.72`) or they collide.
- Use `bend` for loops and fan-outs; a positive bend curves to the left of the direction of travel.
- Keep labels short (≤ 2 words); they sit centred above the line.
- `anim lint` flags arrows that pass through or within 6 px of a box, and boxes that overlap. It does not yet catch arrow-on-arrow collisions, so look at the frame.

**Frames** (`"frame": true`) group a region with a title. Keep 2–4 per diagram.

**Pitfalls seen:**
- Text-width estimates are approximate, so anchor titles `start` when they should line up.
- Long arrow labels need a wider gap between boxes (≥ 170 px).
