# Style guide: Add anything, remove anything

**Source:** "A Programming Paradigm for Spatiotemporal Composability", Shi, Zhang and Cui (Peking University, DeepSeek-AI), arXiv 2608.25512. The framework is called Cordis; its production case study is Koishi.

**Mood:** curious, clear, calm. A great teacher at a whiteboard explaining a systems idea. Not a sci-fi dashboard.

**Visual language**
- The hero is the **program box** (`ctx`): a big dark card on the right labelled "running program". In s5 it is revealed as "one shared context". Everything a plugin does lands *inside* this box as a small chip.
- The hero component is the **plugin card** (`plug`), blue, on the left. When it is plugged in, the blue `plugLink` line connects it to the program box.
- Colours mean one thing each:
  - `plugin` blue = components, and the changes they make (effect chips).
  - `undo` amber = inverses: the undo receipts a component hands the runtime. Amber only ever means "undo".
  - `dep` purple = dependencies (what a component needs or provides).
  - `good` green = clean, active, or unaffected.
  - `bad` red = restart, loss or breakage. Use it sparingly.
- Effect chips are small rounded rects (`chip` fill, coloured stroke) with `mono` or `small` text, e.g. `cmd /greet`, `conn db`.
- Text is sparse: one short title per idea and short labels. The narration carries the explanation. No more than ~6 words of free text at once. No formulas.

**Motion personality**
- Unhurried and precise: `rise-in`, `draw-on`, `pop`, `fly-from`. Nothing spins or bounces for decoration.
- Show cause and effect: chips fly *from* the plugin *into* the program box; undo receipts drop *onto* the plugin's stack; unwinding pops the stack top-first (LIFO), and each popped receipt removes its matching chip.
- Land beats on narration cues; keep gentle motion between beats; no dead air.

**Don'ts:** no logos or product UIs (say "VS Code" in words only); no invented numbers. The only figures are: 87 of the top 100 VS Code extensions run code; Koishi has over 4,000 community plugins.
