# Motion: the house numbers

Read this after `docs/format.md`. It is how a section should *move*. Every rule is a number, and every number came from a review. The tag says where:

- **[M]**: learned from studying Claude Motion's films.
- **[ours: …]**: a review of one of our videos, a judge criterion, or a trace.
- **[lint: rule]**: `anim lint` checks it.

A rule with no tag is a guess. Delete it, or find the review that backs it.

Stage: 1920 × 1080, 30 fps. Times are seconds.

## 1. Always moving, one thing at a time

- A frozen frame reads as a bug. Held shapes **breathe**: `breathe`, ±1–2 % (`amount` 0.01–0.02) on a ~3 s sine. A hero that sits through the whole scene gets it as a through track. [M] [lint: dead-air]
- Ambient motion is not a beat. While the narration talks, something new happens at least every ~4 s. [ours: rubric `motion`, "the section never stalls"] [lint: no-beat]
- One subject at a time. The thing that moves is the thing to read; nothing else starts while it does. [M] [ours: rubric `focus`] [lint: busy]
- Related entrances stagger **0.2–0.4 s**. List rows go **0.05–0.12 s** apart. [M]
- After a big change (new layout, camera move), give **0.6–1 s** to settle before the next important beat. [M]
- Put the next subject where the eye already is, or lead it there with motion (`fly-from`, an arrow drawing toward it). [M]

## 2. Entrances, exits, moves

- Arrivals ease **out**, exits ease **in**, repositioning eases **inOut**. Nothing snaps on or off. [M] [lint: snap-off]
- Entrances **0.35–0.6 s**. Exits are quicker: **0.25–0.4 s**. [M]
- **Shapes overshoot** on arrival: `pop` with `overshoot` **1.4–1.9** (1.5 for pills and chips), or `ease: "spring"` for something that settles. Opacity finishes before scale does (pop does this). [M]
- A shape that lands can **un-rotate** as it lands (`spin` −10 to −30) and get a short decaying **`wobble`** (`amount` 4–9°) to call attention. One per beat, not on every object. [M]
- **Anticipation** on a big move: `anticipate` 0.04–0.08 on `to`, `move`, `fly-from`. Skip it on small nudges. [M]
- **Product UI only eases.** No overshoot, spring, wobble or breathe on anything marked `"ui": true` or on video footage. [M] [lint: ui-bounce]
- **Clear the frame between ideas**: a new idea gets a fresh frame. End every non-final section with `{ "preset": "clear", "at": "end-0.6" }` rather than a pile of separate fade-outs. [M] [ours: cordis has 29 hand-written exit entries across its sections]
- Nothing flashes or blinks more than **3 times a second**. [M] [lint: flash]

## 3. Words

- Words enter from **one direction**, word by word: `words-in`, **0.11 s** apart, drifting **24–34 px**, ease out. Exits are quicker and go the other way (`words-out`, or `clear`). Never a different direction per line. [M]
- A line of words is **one string** in one text object. Don't split a sentence into word objects to animate it: `words-in` does that, and the line stays one edit. [M]
- Make the move mean something: the word that names the problem drifts off, the name lands and stays, a number counts (`count-up`). [M]
- At most **~6 words** of free text on screen at once; the narration carries the explanation. [ours: explainer guide]
- Emphasis is motion (a `pulse`, an underline drawing on), not bold, colour or exclamation marks. [M]
- On-screen size: titles 90–170 px, body ≥ 28 px, labels ≥ 22 px, nothing below **22 px** after the camera's scale. People watch on phones. [M: "body UI text ≥ 26 px"] [lint: small-text]
- Text stays readable for **0.25 s per word + 0.4 s**. [ours] [lint: reading-time]

## 4. The first and last frames

- **Frame 0 is the thumbnail.** It shows the title's first line or the subject, never an empty backdrop. The first section's first entrance starts early: `"at": "start-0.5"` for a line of up to four words, about 0.1 s earlier per extra word. [M] [ours: 9 of our 10 videos opened on a bare backdrop, 2026-10-21] [lint: thumbnail]
- **Open calm.** Title about **2.5 s**, then the subject. At most one camera move in the first 5 s, and it is measured: an eased **1.2–1.5 s** push. A fast camera at the start reads as frantic. [M] [lint: open-calm]
- **End card**: the name or the payoff large, one short line, the accent once. Hold the final picture **≥ 3 s**. This is only for the **last section of the video**: its last beat lands *on* the last spoken line, then holds. If the narration runs to within 3 s of the end, land the picture on that line anyway and say so in your report; the scene planner adds the tail. [M] [lint: end-hold]
- A scene that isn't the last **clears itself** over its last ~0.6 s: scenes hard-cut. [M] [lint: scene-exit]

## 5. Colour and layout

- One accent doing one job. The palette's colours mean one thing each (see `style.md`). [M] [ours: cordis style guide]
- Colours are tokens. A new shade goes into `theme.json` as a token, never a hex in a section. [M] [lint: raw-color]
- Place with regions and relative placements. A `dx`/`dy` over 200 px or an absolute `x`/`y` means a layout primitive is missing; say so in your friction report. [ours: plan.md §7.2] [lint: raw-pixels]
- No glows, gradients, particles or 3D unless the brand has them. [M]

## 6. Worked example

This is `cpu-cache` s2, "the lookup", rewritten with the vocabulary above. Copy **how it is built**: the shapes of the entries, the timing relationships, where the ambient motion and the clear go. Never copy its objects, words, colours or times. (If you are writing `cpu-cache` s2 itself, the brief wins: follow the brief.)

```json
{
  "id": "s2",
  "objects": {
    "s2.fetchArrow": { "type": "arrow", "from": "chip.bottom", "to": "cacheBox.top:0.45", "stroke": "item", "strokeWidth": "thin", "dash": "10 8" },
    "s2.looking": { "type": "text", "text": "checks the cache first", "style": "body", "fill": "muted", "at": { "region": "center", "align": "right", "dx": -160 } },
    "s2.hitTag": { "type": "rect", "w": 180, "h": 72, "radius": "md", "fill": "hit", "text": "HIT", "style": "label", "at": { "in": "cacheBox", "align": "right", "pad": "sm", "dy": -110 } }
  },
  "timeline": [
    { "id": "arrow", "target": "s2.fetchArrow", "preset": "draw-on", "at": "cue:asks", "dur": 0.5 },
    { "id": "fly", "target": "byte", "preset": "fly-from", "at": "cue:asks", "offset": 0.25, "from": "chipBox", "dur": 1.1, "anticipate": 0.05 },
    { "id": "look", "target": "s2.looking", "preset": "words-in", "after": "fly", "gap": 0.1 },
    { "id": "hit", "target": "byte", "preset": "pulse", "at": "cue:hit", "amount": 0.16, "dur": 0.55 },
    { "id": "hl", "target": "byte", "preset": "highlight", "with": "hit", "offset": 0.1, "color": "hit", "dur": 0.9 },
    { "id": "tag", "target": "s2.hitTag", "preset": "pop", "with": "hit", "offset": 0.3, "overshoot": 1.5, "spin": -12 },
    { "target": "s2.hitTag", "preset": "wobble", "after": "tag", "amount": 6, "dur": 0.8 },
    { "id": "restoreB", "target": "byte", "preset": "to", "after": "hit", "gap": 0.55, "dur": 0.3, "to": { "stroke": "none" } },
    { "preset": "clear", "at": "end-0.6" }
  ]
}
```

What it does, beat by beat:
- On the word "asks", the arrow draws toward the cache and the byte follows it, with a small pull-back first.
- The caption enters word by word as the byte lands: one subject at a time.
- On "hit", the byte pulses and flashes green. The badge pops with a slight un-rotate, then wobbles once.
- `clear` takes every local object off in one staggered move, 0.6 s before the cut. The byte stays: it's shared, and key `s2` holds it in the cache.
- The scene's through tracks breathe the chip, cache and RAM, so the holds are never frozen.

## 7. Walkthroughs: showing a product being used

For product tours and "how this flow works" films (like Claude Motion's walkthroughs). It is slower than an explainer: one speed, long holds, the camera does the pointing.

- **The camera points.** Every beat zooms **1.6–2.4×** onto ONE region (`focus` on `camera`, `on` the region). Don't rest on the whole window for more than ~1.2 s. [M] [lint: focus-zoom]
- **Camera moves take 0.55–1.2 s.** Arrivals ease `arrive` (cubic-bezier .22,.7,.24,1); repositioning between nearby regions eases `glide` (.45,0,.2,1). [M] [lint: camera-speed]
- **Hold 1.4–2.2 s** on every point of interest before anything else happens; in doubt, add 0.4 s. Drift 1–2 % on holds. [M] [lint: focus-hold]
- **Spotlight:** dim everything outside the region (`spotlight` object `on` it, opacity 0.5–0.8 for context, 1 for "look exactly here"). Glide it between nearby regions (`move` + `to` w/h); fade out, jump, fade in between distant ones. Off while typing or streaming. [M]
- **Caption chips:** labels, not sentences, **≤ 6 words**, never "successfully". On screen **≥ 1.2–1.6 s**. In the dimmed area, on a leader line to what they name, never over it. A tooltip and a chip never say the same thing. [M] [lint: chip-words, chip-time, chip-over]
- **Cursor:** travels 0.5–0.9 s on an arc, settles 200–300 ms on its target, then clicks. Nothing snaps, nothing teleports. Cross-fades 0.35–0.6 s; menus open in 160–200 ms from their anchor. [M]
- **Text you must read is ≥ ~26 px on screen after the zoom.** [M] [lint: small-text, at 22 px]
- **The close:** one display line and a recap chip per flow; mock data says so, small and grey: "Concept mock · Month YYYY". [M]
- **Don'ts** (each was real feedback): tiny text, resting zoomed out, speech bubbles over UI, a cursor that jumps, highlighter rectangles (use rings and chips), toasts firing off-frame while the camera is elsewhere, frozen holds, hard cuts from slides into UI, real customer names or data. [M]

## 8. Before you stop

Run `anim lint` and read every warning in this file's tags: `thumbnail`, `end-hold`, `open-calm`, `no-beat`, `snap-off`, `small-text`, `ui-bounce`, `raw-color`, `raw-pixels`, `scene-exit`, and for walkthroughs `focus-zoom`, `camera-speed`, `focus-hold`, `chip-words`, `chip-time`, `chip-over`. A warning you leave in place needs a reason in your report.
