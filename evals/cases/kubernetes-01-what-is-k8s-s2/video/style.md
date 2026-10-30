# Style guide: What is Kubernetes?

**Mood:** calm, confident, clear. A friendly systems diagram, not a sci-fi dashboard.

**Visual language**
- Servers ("nodes") are large dark rounded cards (`node` fill, `nodeEdge` stroke) with a small label at the top.
- Containers are small rounded squares in `container` blue. Pods (running copies of the app) are `pod` green.
- Kubernetes itself is the `control` purple card: the conductor. Purple only ever means Kubernetes.
- `bad` red is reserved for failure. Use it once, for the failing server.
- Text is sparse: short labels and at most one caption on screen at a time. The narration carries the explanation.

**Motion personality**
- Purposeful and unhurried. Entrances use `rise-in`, `pop` or `draw-on`; nothing spins or bounces for decoration.
- Movement shows cause and effect: things fly *from* Kubernetes *to* servers.
- Land visual beats on the narration cues. Keep things moving gently between beats; no dead air.
- Stagger groups of similar things (0.06–0.12s).

**Don'ts**
- No logos or trademarks.
- No more than ~8 words of on-screen text at a time.
- Don't put text over busy shapes.
