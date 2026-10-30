# Style guide: How transformers work

**Mood:** curious, clear, a little wonder. A calm whiteboard explanation by a great teacher, not a sci-fi neural-net light show.

**Visual language**
- The sentence "The cat sat because it was tired" is the hero. Its seven words are **token chips**: dark rounded cards (`token` fill, `tokenEdge` stroke) with the word inside. They stay in one row across the whole scene.
- Embeddings (numbers) are `embed` blue: thin bars or short columns of digits.
- Attention is warm `attn` amber, and only attention uses amber. Stronger attention means thicker, brighter lines.
- Layers are `layer` purple: translucent horizontal bands.
- Prediction and probabilities are `pred` green.
- Text is sparse: one short title per idea (e.g. "tokens", "attention") and short labels. The narration carries the explanation.

**Motion personality**
- Unhurried and precise. Entrances use `rise-in`, `draw-on`, `pop`, `type-on`; lines draw on; nothing spins or bounces for decoration.
- Show cause and effect: attention lines grow *from* the looking token *to* the looked-at token.
- Land beats on narration cues. Keep gentle motion between beats; no dead air.
- Stagger similar things (0.04–0.1s).

**Don'ts**
- No logos, brand names or product UIs.
- No more than ~6 words of on-screen text at once (the token chips don't count).
- Don't fake maths: if numbers appear, they're short (e.g. 0.12, −0.8) and few.
