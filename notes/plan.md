# Plan: AI-native animation engine

An engine that turns a brief (a prompt, a report, data) into a narrated, code-based animated video. Claude plans it, writes it, voices it and critiques it, and the scenes are built in parallel. The output is editable structured data that a deterministic renderer turns into MP4. It is never generated frame by frame.

---

## 1. Principles

1. **Design for how the model works.** Claude can't see its output, is unreliable with pixel coordinates and timing arithmetic, and is strong at meaning, structure and revision. So:
   - give it **eyes**: render keyframes and have it critique them
   - give it **layout constraints and relative timing**, never raw coordinates
   - give it **semantic IDs and patches**, never "regenerate everything"
2. **Structured data is the source of truth.** The model writes JSON in our schema, never arbitrary renderer code. The renderer is ours, deterministic and tested.
3. **Time is a pure function.** `render(scene, t)` returns the same frame every time for the same `t`. No wall clock, no unseeded randomness, no dependence on how long the page has been running. This makes seeking, parallel rendering, seam checks and the critique loop possible.
4. **Narration comes first.** The voiceover is generated before the animation. Its length sets durations and its word timestamps set cue times.
5. **Modular by contract.** Scenes and sections are independent files connected by explicit contracts (key states, hand-offs). Anything with a contract can be built in parallel.
6. **Taste is built in.** A curated library of presets and themes plus a linter makes the default output look designed.

---

## 2. Hierarchy

```
Project   — the whole video: theme, voice, scene order, transitions between scenes
└─ Scene    — a narrative unit (~20–40s): one "stage", one continuous narration pass
   └─ Section — a parallel unit of work (~10s) inside a scene, joined to its neighbours with no visible cut
```

| Boundary | Visual join | Contract | Who owns the join |
|---|---|---|---|
| Section → section | No cut. Must match pixel for pixel | **Key states** at the boundary | Scene planner |
| Scene → scene | Transition (cut, morph, wipe…) | **Hand-offs** for objects that carry over | Director / assembler |

### Video types

Above the hierarchy sits the **type**: what kind of video this is and how it's made. Types live in `video-types/<id>/`:
- `type.json`: what it's for, the pipeline steps, which capabilities it uses, and a scaffold
- `guide.md`: what has worked and what has gone wrong
- `style.md`: a style template
- extras, such as the product-tour recorder

Each video names its type in `project.json`. Commands:
- `anim types` lists the types.
- `anim new <type> <dir>` scaffolds a video and prints its steps.
- `anim videos` catalogs every video by type, with features, lint, render freshness (a fingerprint of compiled scenes, audio, clips and engine) and eval coverage.

Eval cases inherit a `type:<id>` tag, so runs and experiments can be sliced by type (`--cases type:explainer`).

| type | made by | examples |
|---|---|---|
| `explainer` | narration → scene plan with a shared hero metaphor → section agents in parallel | kubernetes, transformers, evals |
| `diagram` | semantic boxes and arrows drawn on their cues; also plays live on tldraw | feature-whiteboard, architecture |
| `product-tour` | real app footage (Playwright) in a framed window, with rings and callouts on cues, plus a score | none in this repo yet |

A new type earns its folder once one video of that kind has been made and reviewed, so its guide holds real lessons rather than guesses.

---

## 3. Pipeline

```
brief
  │
  ▼
[1] Director (1 call) ──► script outline, scene list, theme, style guide, scene hand-offs
  │
  ├──────────── per scene, in parallel ────────────────────────────────┐
  │ [2] Narration writer ─► narration.txt with {cue:name} markers      │
  │ [3] Kokoro TTS (whole scene, one pass) ─► vo.wav + vo.words.json   │
  │ [4] Scene planner (1 call) ─► stage, key states, through tracks,   │
  │     section spans snapped to natural pauses                        │
  │   ├──────── per section, in parallel ──────────────┐               │
  │   │ [5] Section agent ─► section JSON               │               │
  │   │ [6] lint → render keyframes → critique → patch  │ (≤ N rounds)  │
  │   └─────────────────────────────────────────────────┘               │
  │ [7] Seam check per section boundary; regenerate the failing section │
  └─────────────────────────────────────────────────────────────────────┘
  │
  ▼
[8] Assembler: check hand-offs, build transitions, continuity review of a contact sheet
[9] Render: scenes/sections in parallel → concatenate
[10] Audio: concatenate VO, duck the music bed, normalize loudness → mux → MP4 (+ captions)
```

Only steps 1 and 4 (planning) run in sequence. The creative work in steps 5–6 runs fully in parallel: a 3-minute video of six 30-second scenes means 18 section agents at once.

---

## 4. Project layout on disk

```
my-video/
  project.json            # fps, size, voice, music, scene order, transitions, shared objects, hand-offs
  theme.json              # design tokens: palette, type scale, easing set, timing scale, stroke widths
  style.md                # short style guide from the director: mood, motion personality, dos and don'ts
  scenes/
    01-hook/
      narration.txt       # source text with {cue:name} markers
      vo.wav              # generated
      vo.words.json       # generated: [{ "word", "start", "end" }]
      scene.json          # stage, keys, through tracks, section spans
      sections/
        s1.json           # owned by one section agent
        s2.json
        s3.json
      assets/             # SVGs, icons, data files local to this scene
    02-problem/ ...
  build/                  # content-hashed cache: resolved timings, keyframe PNGs, rendered segments
  out/                    # final MP4, captions (.vtt), contact sheet
```

Ownership rules (they're what make parallel work safe):
- A section agent writes **only** its own `sections/sN.json` and may add files under `assets/`.
- A scene planner writes **only** `scene.json`.
- `project.json`, `theme.json` and `style.md` are read-only below the director.
- Object IDs are prefixed with scene and section (`s02.chart`, `s02.s3.callout`). Objects shared across a whole scene are declared in `scene.json`; objects shared across the project are declared in `project.json`.

---

## 5. Data model

### 5.1 `project.json`

```json
{
  "fps": 30, "size": [1920, 1080],
  "voice": { "engine": "kokoro", "voice": "af_heart", "speed": 1.0 },
  "music": { "file": "assets/bed.mp3", "duck_db": -14 },
  "scenes": ["01-hook", "02-problem", "03-solution"],
  "transitions": [
    { "between": ["01-hook", "02-problem"], "type": "cut" },
    { "between": ["02-problem", "03-solution"], "type": "morph", "duration": 0.6 }
  ],
  "shared": { "logo": { "type": "svg", "asset": "assets/logo.svg" } },
  "handoffs": [
    { "from": "02-problem", "to": "03-solution", "object": "chart",
      "state": { "region": "left-half", "size": "lg", "fill": "accent" } }
  ]
}
```

### 5.2 `scene.json`

```json
{
  "id": "02-problem",
  "stage": { "title": "top-left", "chart": "center", "callout": "right-third" },
  "objects": {
    "title": { "type": "text", "text": "Revenue, 2021–2026", "style": "h2" },
    "chart": { "type": "chart", "kind": "bar", "data": "assets/revenue.csv" }
  },
  "keys": {
    "0":  { "chart": { "visible": false }, "title": { "visible": false } },
    "s1": { "chart": { "axes": "drawn", "bars": 0 }, "title": { "size": "sm" } },
    "s2": { "chart": { "bars": "full" } },
    "end":{ "chart": { "region": "left-half", "size": "lg", "fill": "accent" } }
  },
  "through": [{ "target": "camera", "preset": "drift", "amount": "subtle" }],
  "sections": [
    { "id": "s1", "target": [0, 10],  "brief": "Title lands, axes draw on" },
    { "id": "s2", "target": [10, 20], "brief": "Bars grow on the narration cues" },
    { "id": "s3", "target": [20, 30], "brief": "Callout pops; chart moves to its hand-off state" }
  ]
}
```

- `keys` are named after the section that ends at that boundary (`"s1"` = state at the end of s1, which is the start of s2). `"0"` is the scene start and `"end"` is the scene end. The `"end"` key must satisfy the project hand-off.
- `target` spans are what the planner wants. **Resolved** spans (after snapping to pauses) are written to `build/02-problem/timing.json`, never back into the source file.

### 5.3 `sections/s2.json`

```json
{
  "id": "s2",
  "objects": {
    "growthLabel": { "type": "text", "text": "+40%", "style": "stat", "region": "chart.top-right" }
  },
  "timeline": [
    { "target": "chart.bars.*", "preset": "grow-up", "at": "cue:first-year", "stagger": 0.12 },
    { "target": "growthLabel",  "preset": "count-up", "at": "cue:growth", "from": 0, "to": 40 },
    { "target": "growthLabel",  "preset": "fade-out", "after": "growthLabel", "gap": 1.5 }
  ]
}
```

### 5.4 Object types (v1)
`text`, `shape` (rect, circle, line, arrow), `path` (SVG `d`), `icon` (Iconify reference), `svg` (asset with named inner groups), `group`, `chart` (data-bound: bar, line, pie, number). Images and 3D come later.

### 5.5 Layout
- The scene `stage` assigns named **regions** to objects. Regions are named areas (`center`, `left-half`, `right-third`, `top-left`, …) resolved against a safe-area grid.
- Inside a region, objects use **layout primitives**: `stack` (row/column, gap, align), `grid`, and `anchor` (relative to another object: `"below": "title"`, `"chart.top-right"`).
- Sizes and gaps use theme tokens (`sm`/`md`/`lg`), never pixels. Pixels are allowed only as an escape hatch, and the linter warns about them.

### 5.6 Timing
Time references, resolved to absolute scene time by a timing solver:
- `at: "cue:name"`: the start time of the word after the `{cue:name}` marker
- `at: <seconds>`: relative to the section start
- `after: "<id>"` with an optional `gap`; `with: "<id>"` with an optional `offset`
- `stagger` across wildcard targets (`bars.*`)
- preset durations come from the theme timing scale unless overridden

### 5.7 Presets (v1 library, ~15)
`fade-in`, `fade-out`, `rise-in`, `pop`, `scale-in`, `draw-on` (stroke reveal), `type-on`, `wipe`, `grow-up`, `count-up`, `slide-to` (move to a region or key state), `morph` (path morph via flubber), `highlight`, `pulse`, `drift` (through tracks). Each preset is a pure function `(object, progress, params) → props`, with easing from the theme.

### 5.8 Edits are patches
Every revision, from the critique loop or from a user, is an RFC 6902 JSON Patch against one file. Patches are stored as history, which gives undo, diffs, branching variants and an audit trail.

---

## 6. Voiceover

1. **Narration writer** (per scene) writes for the ear: short sentences, numbers spelled out, a spelling hint for awkward names, and `{cue:name}` markers where visuals should land. Word budget is about 150 words per minute × the target scene length.
2. **Kokoro** (82M parameters, Apache-2.0, CPU-friendly) voices the **whole scene in one pass**, so intonation never resets at section boundaries. Cue markers are removed before synthesis; their word positions are kept.
3. **Word timestamps.** Use the timestamps from the Kokoro Python package (English) if the installed version provides them. **Verify this in M2.** Fallback: forced alignment of the audio with whisperX or stable-ts. Either way the output is `vo.words.json`.
4. **Section split.** The candidate boundaries are the gaps between words, scored by pause length and punctuation (sentence > clause > word). Each target boundary (10s, 20s…) snaps to the best-scoring candidate within ±2s. Result: spans like 9.4s / 10.8s / 9.8s.
5. **Exact-length mode** (optional): adjust Kokoro `speed` within ±8% or add held frames to hit fixed durations.
6. **Captions** come from the same `words.json` as WebVTT.

Runtime: Python sidecar (`vo/`, managed with `uv`) behind a small CLI that takes `narration.txt` and outputs `vo.wav` plus `vo.words.json`. `kokoro-js` (Node/ONNX) is the alternative if we later want a single language.

---

## 7. Validation

### 7.1 Schema validation
Zod schemas are the single definition of the format. The JSON Schema for the model's structured output is generated from them.

### 7.2 Linter (deterministic, runs on resolved timing and layout)
| Rule | Fails when |
|---|---|
| reading-time | text is on screen for less than about 0.3s per word + 0.5s |
| overlap | two visible objects' boxes intersect without an explicit `layer`/`overlay` intent |
| offscreen | an object leaves the safe area while visible (unless entering or exiting) |
| contrast | text-to-background contrast < 4.5:1 |
| busy | more than 3 independent motions start within 0.3s |
| dead-air | nothing moves for more than 2.5s while narration plays |
| key-state | a shared object's state at a section boundary ≠ the declared key |
| boundary-spill | a section animation runs past its section end (should be a through track) |
| unresolved | a cue, ID or region reference doesn't resolve |
| raw-pixels | pixel values are used where a token exists (warning) |

### 7.3 Seam check
For each section boundary at time `b`, render the frame at `b` once from section A's last state and once from section B's first state, then compare pixels. If the difference passes a threshold, report the objects responsible and regenerate only the section that broke its key state.

### 7.4 Critique loop (vision)
- Render keyframes: section start/end, the start and end of every animation, and the 25/50/75% points.
- Send them to Claude as images, with the section brief, the style guide and the linter output, against a fixed rubric: hierarchy, readability, composition and balance, motion clarity, fit with the narration, style consistency.
- Claude returns either `{"verdict": "pass"}` or a JSON Patch. Maximum 3 rounds per section, then accept and flag the section for human review.

### 7.5 Continuity review
After all sections are done, a reviewer sees a contact sheet (keyframes of every section in order) and the style guide, flags drift (palette, type, motion personality, pacing) and sends patches back to specific sections.

---

## 8. Rendering and export

- **Renderer:** TypeScript, SVG DOM. `evaluate(scene, t)` resolves every object's properties at time `t` (through tracks + active section, offset to its start), and `paint(state)` updates the SVG.
- **Preview:** browser page with a scrubber, play/pause, section markers and lint overlays.
- **Export v1:** headless Chromium (Playwright) seeks frame by frame and pipes frames to ffmpeg. Sections render in parallel as segments, then ffmpeg concatenates them and muxes the audio.
- **Export v2:** in-browser encoding with WebCodecs (no ffmpeg per frame), Lottie export, and interactive HTML export.
- **Determinism:** fonts bundled locally, seeded randomness only, no network at render time, and a fixed device pixel ratio.

---

## 9. Agents and the Claude API

| Role | Calls | Input | Output |
|---|---|---|---|
| Director | 1 per project | brief, source material | outline, scene list, theme, style guide, hand-offs |
| Narration writer | 1 per scene | outline, scene purpose, word budget | `narration.txt` |
| Scene planner | 1 per scene | narration + words, style, hand-offs | `scene.json` |
| Section agent | 1+ per section | scene plan, its slice of the words, brief | section JSON |
| Critic | ≤3 per section | keyframes, brief, lint output | pass or JSON Patch |
| Continuity reviewer | 1 per project | contact sheet, style guide | patches per section |

- **Model:** `claude-opus-5-5` for every role by default, configurable per role. Set `output_config.effort` explicitly per role (the Opus 5.5 default is `medium`). Start at `high` for director and scene planner and `medium` for section agents and critics, then tune using the eval set (§11).
- **Structured outputs:** every role returns JSON through `output_config.format` / `messages.parse()` with schemas generated from the Zod definitions. Forced `tool_choice` isn't available on Opus 5.5, so don't rely on it.
- **Vision:** keyframes are sent as PNG image blocks.
- **Prompt caching:** parallel section calls share one long, stable prefix: system prompt, format reference, preset catalog, theme, style guide, then the scene plan. Put the section-specific brief after the last cache breakpoint. Warm the cache once before fanning out to the section agents. Check `usage.cache_read_input_tokens` to confirm hits.
- **Refusals:** check `stop_reason` before reading content, and enable the server-side `fallbacks` option.
- **Batch API** (50% cost) for jobs that aren't latency-sensitive, such as nightly evals or bulk re-renders.

---

## 10. Interfaces

The engine is a library. These are the front ends over it:

- **CLI:** `anim new`, `anim plan`, `anim voice`, `anim build [scene[/section]]`, `anim lint`, `anim render`, `anim preview`
- **MCP server** (so Claude Code and other agents can drive it): `create_project`, `plan_scene`, `generate_section`, `patch`, `lint`, `render_frame` (returns a PNG), `render_contact_sheet`, `voice_scene`, `export`
- **Editor UI** (later): preview, timeline, selecting objects by semantic name, natural-language edits applied as patches. tldraw can serve as a storyboard canvas (check its licence first).

---

## 11. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (engine, CLI, MCP), Python (Kokoro sidecar only) | |
| Schemas | Zod → JSON Schema | Single definition of the format |
| Rendering | SVG DOM + our own evaluator | GSAP not used as the engine; its easing functions can be borrowed |
| Path morphing | flubber | |
| Sketch style | Rough.js (optional theme) | |
| Icons | Iconify | |
| Charts | Our own `chart` object type (d3-scale / d3-shape for the maths) | Data-bound, so numbers are always correct |
| Headless render | Playwright + Chromium | |
| Encode / mix | ffmpeg | WebCodecs later |
| TTS | Kokoro (Python `kokoro`) | whisperX / stable-ts as alignment fallback |
| LLM | Claude API, `@anthropic-ai/sdk` | |
| Later | Three.js for 3D scenes, tldraw for the canvas, Lottie export | Check licences for tldraw (and Remotion, if we ever adopt it) |

---

## 12. Milestones

Each milestone ends with something demonstrable.

**M0: Format and renderer (no AI)**
- Zod schemas for project, scene and section; timing solver; layout solver (regions + stack/anchor); 8 presets
- Hand-written sample: one 30-second scene with 3 sections
- Browser preview with scrubber
- ✅ The sample plays correctly in preview; `evaluate(t)` is deterministic (test: same `t` → same frame hash)

**M1: Export and validation**
- Playwright + ffmpeg export, sections rendered in parallel
- Linter (all rules in §7.2), seam check
- ✅ The sample exports to MP4; a deliberately broken key state fails the seam check and names the object

**M2: Voiceover**
- Kokoro sidecar, `words.json`, cue resolution, snapping sections to pauses, audio mux, captions
- ✅ The sample scene is narrated and every cue lands on its word (checked by ear and by the timing report)

**M3: Agents, first full slice**
- Director → narration → Kokoro → scene planner → 3 parallel section agents → critique loop → seam check → MP4
- Prompt caching across the parallel calls; per-call cost and latency logged
- ✅ A brief becomes a narrated 30-second, 3-section scene with no hand edits; seams pass; cost per scene is recorded

**M4: Multi-scene**
- Hand-offs, transitions (cut, crossfade, morph), continuity reviewer, music ducking
- ✅ A brief becomes a 90-second, 3-scene video with one morph hand-off

**M5: MCP server and CLI polish**
- ✅ Claude Code produces and revises a video entirely through MCP tools, including `render_frame` for self-review

**M6+: Editor UI, variants (N art directions per scene), Three.js scenes, Lottie / HTML export, WebCodecs encoder**

### Eval set (starting in M3)
About 10 fixed briefs (data report, product explainer, concept explainer, list or countdown, …). Each run records lint pass rate, seam pass rate, critique rounds used, cost and wall time, and keeps a contact sheet for side-by-side human review. Every prompt or model change is measured against it.

---

## 13. Open questions

1. **Who is the main user: AI agents or people?** Working assumption: build the engine plus CLI/MCP first (agents as users) and the editor UI second. Confirm before M5.
2. **Kokoro timestamps:** are the built-in word timestamps accurate enough, or do we always align with whisperX? Decide in M2.
3. **Section length:** is 10s the right unit? Measure quality and cost per section in M3 and try 6–15s.
4. **Art beyond icons and simple SVG:** when do we add AI-generated illustration (image model → vectorize)? Deferred until the core loop is good.
5. **Licensing** for tldraw (and Remotion if adopted) before any commercial use.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Style drifts across parallel agents | Shared tokens and presets, style guide, continuity review |
| Seams don't match | Explicit key states, seam check, regenerating only the failing section |
| Critique loop never settles | Hard limit of 3 rounds, a fixed rubric, then flag for a human |
| The layout solver is too limited, so the model reaches for pixels | Track raw-pixel warnings; extend primitives where they cluster |
| Cost of many parallel Opus calls | Prompt caching across sections, effort tuned per role, Batch API for offline work |
| Rendering differs between machines | Bundled fonts, fixed device pixel ratio, pinned Chromium, frame-hash tests |
