# Style guide: Why the CPU cache exists

**Mood:** curious, clear, calm. A great teacher at a whiteboard, not a sci-fi light show.

**Visual language**
- The hero: the **memory stack** — a purple CPU chip with a small blue **Cache** bar directly under it and a much larger dark **RAM** bar under that. Size means speed×capacity: the cache is small and fast, RAM is huge and slow. The stack stays on the left; the right third is free for the beat's caption or stat.
- Colours mean one thing each: `cpu` purple = the processor; `cache` blue = the cache (the hero); `ram` = main memory; `item` amber = a single byte of data; `hit` green = a hit; `miss` red = a miss. Nothing else is coloured.
- Text is sparse: one short caption or one number at a time; the narration carries the explanation. No more than ~6 words of free text on screen.

**Motion personality**
- Unhurried and precise: `rise-in`, `pop`, `draw-on`, `fly-from`, `to`. Nothing spins or bounces for decoration.
- Show cause and effect: the byte flies *from* the CPU *into* the cache; the evicted byte *leaves* the cache.
- Land beats on narration cues; keep gentle motion between beats; no dead air > 2.5 s.
- Stagger similar things by 0.06–0.12 s.

**Don'ts**
- No invented numbers: use only the latency figures in `scene.json`.
- No logos or product UIs; don't put text over busy shapes.
