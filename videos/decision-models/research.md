# Research: decision models (2026-10-21)

Facts the narration and briefs rely on, with sources. Vendor figures are marked as such and are not used on screen.

## What they are
- A decision model takes a **state** (text, JSON, images) and a map of typed **questions**, and returns a probability for every allowed answer. No text is generated (`output_tokens: 1` in Ollama's usage; Clef emits none). [Ollama docs, Clef card]
- Question types: `choice` (2–26 named options in Ollama; Clef allows more), `noul` (yes/no → p(true)), `score` (2–10 ordered levels → probability-weighted level). Jev 1.14 adds an experimental `box` type for images. [Ollama docs, Copes]
- One request can ask up to 64 questions over one shared state. [Ollama docs]
- Clef: the Qwen backbone does a prefill-only pass; a small "joint schema head" scores every option of every question at once; softmax per question. Backbone frozen; head + LoRA trained on synthetic schemas; RL stage for calibration ("RLCD"). [Clef card, Copes]
- Because answers are limited to the options in the schema, the model cannot return an option you didn't define ("can't hallucinate" in vendor terms; a valid answer, not necessarily a correct one). [DataCamp, Copes]
- "System One" is Kahneman's fast, intuitive system; TypeSafe positions reasoning LLMs as System Two. [Copes, DataCamp]

## Who
- **Jev**: TypeSafe AI, hosted only (no weights), announced 2026-09-15. [MarkTechPost, DataCamp]
- **Clef (27B) and Clef-Flash (9B)**: Cloudflare, open weights, Apache-2.0, 2026-10-01, API-compatible with Jev; Clef-Flash is post-trained from Qwen3.5-9B with its vision encoder. [Clef card, The Register/Slashdot]
- **Ollama 0.35** added `POST /v1/systemone` and decision models (nimble, tev1); Clef image judging needs 0.35.1+. [Ollama docs, Ollama blog]

## Limits
- Weaker than frontier LLMs on reasoning-heavy benchmarks (e.g. Clef-Flash 51.0 vs Jev 78.3 on GPQA Diamond, Cloudflare's own run). [Clef card]
- No rationale: a number, no explanation. [DataCamp]
- Literal reading; arithmetic, counting, dates are better in code. [Copes]

## Ours
- `anim eval judge --judge decision:clef-flash`: one `/v1/systemone` call per section, the contact sheet as the shared image, every rubric criterion as a `noul`; ~15–20 s per call on an M4 Pro, free (docs/evals.md).

## Sources
- https://docs.ollama.com/capabilities/decision
- https://huggingface.co/Cloudflare/clef-flash
- https://flaviocopes.com/clef/ · https://flaviocopes.com/jev/
- https://www.datacamp.com/blog/system-one-models-jev
- https://www.marktechpost.com/2026/09/19/typesafe-ai-releases-jev/
- https://tech.slashdot.org/story/26/10/01/2110250/
- https://ollama.com/library/clef-flash
