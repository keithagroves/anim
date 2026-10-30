# Scene format reference (for section agents)

You are building **one section** of a scene. A section is a ~10s slice of a narrated scene. Other agents build the other sections **at the same time**, so you only touch your own file and you must honour the contract (key states) exactly.

## What you own

- **Write only:** `videos/<video>/scenes/<scene>/sections/<sectionId>.json`
- **Read:** `scene.json` (stage, shared objects, keys, your brief), `narration.txt`, `../../style.md`, `../../theme.json`
- **Never edit:** `scene.json`, `project.json`, `theme.json`, other sections, or engine code.

## Section file

```json
{
  "id": "s2",
  "objects": {
    "s2.caption": { "type": "text", "text": "Hello", "style": "h2", "at": { "region": "middle" } }
  },
  "timeline": [
    { "target": "k8s", "preset": "rise-in", "at": "cue:conductor" },
    { "target": "s2.caption", "preset": "fade-in", "after": "k8s", "gap": 0.2 }
  ]
}
```

- **Local objects** (in `objects`) exist only during your section. Their ids **must** start with `<sectionId>.` (e.g. `s2.caption`). They must be invisible by the time your section ends (unless you are the last section).
- **Shared objects** live in `scene.json`. You may animate them, but at the end of your section they must sit **exactly** in the key state named after your section (`keys.<sectionId>`). At the start of your section they're already in the previous key state.

## The contract: key states and seams

The state of a shared object at your section's start = its base props + every earlier key. `keys.s1` = how things look at the **end** of s1 (= start of s2).

`anim lint` runs a **seam check**: it evaluates the frame at each boundary from both sides and reports any shared-object property that jumps. Typical fixes:
- Key says `opacity: 1` at your end → you must bring that object in (e.g. `rise-in`, `fade-in`, `pop`, `draw-on`) and finish **before** your section ends.
- Don't leave a shared object scaled, moved or recolored at your end unless the key says so (use `to` to put it back).
- Animations must finish inside your section span (`boundary-spill` error), except in the last section.

## Objects

| type | key fields |
|---|---|
| `rect` | `w`, `h`, `radius` (sm/md/lg or px), `fill`, `stroke`, `strokeWidth` (thin/md/bold), `shadow` |
| `circle` | `r` |
| `text` | `text` (`\n` for lines; `{value}` is replaced by the animatable `value`), `style` (h1 h2 h3 body caption label small mono stat), `anchor` (start/middle/end), `fill`, `decimals` |
| `line` / `arrow` | `from`, `to`: `"objId"`, `"objId.top"` (center/top/bottom/left/right), `"objId.top:0.25"` (25% along that side) or `[x, y]`; `dash` (e.g. `"12 10"`); **`bend`**: curve it — the middle sits that many px off the straight line, positive = to the left of the direction of travel (an arrow drawn right→left with `bend: -80` arcs *upward*); `text`: label centred on the line's middle, on its left (above a left→right arrow; on the bulge side of a curve), sized by `style` (default `small`). `draw-on` traces the curve and the arrowhead follows it. Use this for arcs (e.g. attention lines between tokens) instead of hand-written paths. |
| `path` | `d`, `w`, `h`, `viewBox` |
| `svg` | `svg` (inner markup), `w`, `h`, `viewBox` |
| `video` | `src` (clip file in the video folder, e.g. `"clips/home.webm"`), `w`, `h`, `radius`, `stroke`. Shows frame `time` of the clip (default the first frame); play it with the `play` preset. |
| `spotlight` | `on` (the object it frames: sized to it plus `pad`, default 24, and centred on it), or `w`/`h`/`at`; `radius` (18). Dims everything outside its window (to 55 % at opacity 1); its `opacity` is the amount (0.5–0.8 context, 1 "look exactly here"). Sits above the scene. Glide it with `move` + `to` w/h |
| `chip` | `text` (≤ 6 words), `to` (the point it names: `"btn"`, `"btn.left"`), `at` (where the pill sits: beside the thing, never on it), `style` (label). A light pill with dark words on a leader line with a dot at its end; `draw-on` draws the leader; Motion's chip enters with a 0.35 s fade and a 12 px rise (`rise-in`, `distance` 12, `dur` 0.35). Sits above spotlights |
| `group` | `children` (ids); optional `layout: { "dir": "row"|"col", "gap": "md", "align": "center" }` to stack its children. Layout groups nest: a `col` group of `row` groups is a grid |

Colors are theme tokens (`text`, `muted`, `accent`, `accent2`, `good`, `warn`, `bad`, `surface`, `surface2`, `line`, `bg`, plus the video's own: see `theme.json`). Hex works but lint flags it (`raw-color`): one token change should recolor the film. `opacity` and `layer` (paint order; higher is on top) work on everything. `"hud": true` (root objects) paints it outside the camera, over the scene: a `focus` or `drift` never moves or scales it. Use it for a muted cut's headline or a caption that must stay readable through a zoom. `"ui": true` marks product UI (video objects are UI already): it only eases, and lint flags overshoot, springs, wobble or breathing on it (`ui-bounce`).

## Placement (`at`): never use raw pixels

- Region: `"middle"` or `{ "region": "left-half", "align": "top-left", "dx": 0, "dy": 0 }`
  Regions (1920×1080, 96px safe margin): `full center left-half right-half top-half bottom-half left-third center-third right-third left-two-thirds right-two-thirds top middle bottom top-left top-right bottom-left bottom-right`. `top`/`bottom` are bands 28% of the safe height; `middle` is between them. Every region sits inside the safe margin **except `full`, which is the whole 1920×1080 canvas** (use `center` for the full safe area).
- Inside another object: `{ "in": "node2", "align": "top-left", "pad": "md" }`
- Next to another object: `{ "below": "title", "gap": "md", "align": "left" }` (also `above`, `leftOf`, `rightOf`)
- Align values: `center top bottom left right top-left top-right bottom-left bottom-right`
- Spacing tokens: `xs 8, sm 16, md 32, lg 64, xl 112`. `dx`/`dy` nudge in px when you really need it.

## Timeline entries

```json
{ "target": "s1.box*", "preset": "pop", "at": "cue:many", "stagger": 0.05, "dur": "fast", "ease": "out" }
```

- **When** (choose one; default = right after the previous entry):
  - `at`: seconds from **your section's start**, or a time string: `"cue:<name>"` (that narration word), `"start"` / `"end"` (of your section), `"<sectionId>"` / `"<sectionId>.end"`, each with `+`/`-` seconds: `"end-0.6"`, `"cue:intro+0.2"`. Plus optional `offset`.
  - The **first section** may start before 0 (`"at": "start-0.5"` or `-0.5`): frame 0 is the thumbnail, so the first line should already be readable there.
  - `after: "<id|target>"` (+ `gap`): after that entry ends
  - `with: "<id|target>"` (+ `offset`): when that entry starts
- `target` can be an id, a glob (`s1.c*`), or a **list** of ids/globs (optional only for `clear`): `"target": ["podA", "podB", "podC"]`. Matches are staggered by `stagger` seconds — for a list, **in list order** (so you control the order, e.g. centre-out). Use a list when a glob would also match child objects (`tok*` matches `tok1Box` and `tok1Text` too).
- `dur`: seconds or `fast` (0.35) / `base` (0.6) / `slow` (1.0), `rest` (until your section ends) or `all` (until the scene ends; through tracks).
- `ease`: `linear in out inOut expoOut back spring sine arrive glide`. `arrive` and `glide` are walkthrough camera curves (an arrival; repositioning between nearby regions). `back` overshoots; tune it with `overshoot` (default 1.7; 1.4–1.9 for shapes, 1.5 for pills). `spring` overshoots ~11%, rings once and settles: use it for an arrival that settles. Never `back` or `spring` on UI.
- Give entries an `id` to refer to them later.

### Presets

| preset | what it does | params |
|---|---|---|
| `fade-in` / `fade-out` | opacity | |
| `rise-in` / `sink-out` | fade + vertical travel | `distance` |
| `pop` / `pop-out` | lands with overshoot (scale 0.4 → 1, opacity done in 0.2 s) / scales to 0 | `overshoot`, `spin` (degrees it un-rotates from, e.g. -30) |
| `scale-in` | 0.85 → 1 with fade | |
| `draw-on` / `draw-off` | stroke draws on, then fill fades in | |
| `type-on` | text types on (duration scales with length) | |
| `wipe-in` | revealed left → right | |
| `words-in` / `words-out` | text enters word by word from one `side` (default right), each word drifting `distance` px (28) `pace` s apart (0.11); exits quicker toward the other side (default left). Duration fits the text. The text stays ONE string | `side`, `distance`, `pace` |
| `lines-in` / `lines-out` | the same, line by line (`pace` 0.28) | `side`, `distance`, `pace` |
| `fly-from` | flies into its home position from another object or placement | `from`, `anticipate` |
| `to` / `move` | tween props, or move to a placement | `to: { "fill": "bad", "scale": 1.1, "opacity": 0.4 }` or `to: "right-half"` / `to: { "in": "node1" }`; `anticipate` (e.g. 0.06: pulls back 6% of the move first) |
| `count-up` | tween `value` for `{value}` text | `to: { "value": 3 }` |
| `pulse` | scale bump and back | `amount` (0.08) |
| `shake` | horizontal shake | `amount` (16 px), `cycles` (4) |
| `wobble` | rotation shake that decays: attention after something lands | `amount` (9°), `cycles` (3) |
| `highlight` | stroke flashes to a color and back | `color` |
| `play` | play a `video` clip: advances its `time` from `start` (clip seconds; default where it is) at `rate` (default 1) for `dur` timeline seconds. Several plays in a row make an edit (jump cuts between sections are fine) | `start`, `rate`, `dur` (required) |
| `drift` | slow push-in (camera through track) | `amount` |
| `focus` | camera only: zoom onto `on` (an object or placement) so it fills ~84 % of the frame, at most 2.4×; `on: "full"` goes back to the whole frame. Default 0.9 s, ease `arrive` | `on`, `zoom` |
| `breathe` | ambient: a held shape stays alive, scale ±`amount` (0.012) on a `period` s sine (3). Default `dur: "rest"`. Eases in and out, so it never breaks a seam; each target in a list gets its own phase | `amount`, `period` |
| `sway` | ambient: slow rotation wobble while held, ±`amount`° (1.2) | `amount`, `period` |
| `creep` | ambient: drifts `amount` px/s (2) toward `side` (up), never reversing. Doesn't return, so not on shared objects that must end on a key | `amount`, `side` |
| `clear` | the section clears itself: every target (default **all your local objects**) fades and drifts `distance` px (40) toward `side` (left), staggered 0.06 s apart (closer when there are many, so the whole set takes ~0.25 s; give `stagger` to override). Write `{ "preset": "clear", "at": "end-0.6" }` instead of one exit per object | `side`, `distance`, `stagger` |

Entrance presets (`*-in`, `pop`, `draw-on`, `type-on`, `words-in`, `lines-in`, `fly-from`) keep their object **hidden until they start**, so a local object with an entrance doesn't need any other setup.

Ambient presets (`breathe`, `sway`, `creep`, `drift`) keep a hold alive: they count against `dead-air` but are not beats (`no-beat` still wants something new every ~4 s while the narration talks) and make no foley.

Animatable props for `to`: `opacity scale rotate dx dy w h fill stroke strokeWidth fillOpacity draw reveal clip value`, plus `at` (move to a placement).

A section whose file doesn't exist yet compiles to a **placeholder**: a dashed card with its id and brief, held for its span. The rest of the video plays and lints around it (seams into it aren't checked), and the preview marks it "not written yet".

## Storyboard: section sketches and `anim plan`

Before any section is written, the planner draws each one: a `sketch` on the section in `scene.json`, the frame at its key moment in a **96 × 54** box. `anim plan <video>` lays them out as a storyboard (`build/<scene>/plan.png`) with each section's span, cues and brief, so the person can judge the film before agents spend anything. A section that isn't written yet shows its sketch in the preview, roughly drawn in black and white, behind its "not written yet" card.

```json
{ "id": "s2", "target": [8, 18.5], "brief": "…",
  "sketch": { "paths": ["$5 M48 12h42v28h-42z", "$2 M60 28h21v3h-21z", "$4l~0.6 M60 22h22v3h-22z", "$2~0.8 M45 8v38"] } }
```

- **A path is one string:** paint, ONE space, path. Paint is a role (`$1`…`$5`), `$2d` / `$2l` (30 % darker / lighter), or `#rrggbb(aa)` for what must never change (a glow `#ffffff33`, a shadow `#00000033`). Add `~` and a width (≤ 12) for a line (`~` alone: 1.5); without it the path is filled, so anything not closed needs the `~`.
- **Roles** are `theme.json`'s `roles`: `$1` ground, `$2` main, `$3` second, `$4` accent or ink, `$5` a light spare. Default `["bg", "accent", "accent2", "text", "surface2"]`. A new palette recolours every sketch.
- **Paths** take only M L H V C S Q T A Z (either case), digits, spaces, commas, dots and minus. Whole numbers, one decimal at most, relative commands. A disc: `M16 20a5 5 0 1 0 10 0a5 5 0 1 0 -10 0`.
- **8–12 paths a frame** (at most 24, 600 characters each, 4,000 a sketch). The real composition: what is big, where it sits, what just arrived; text as bars (a short thick bar for a heading, thin bars for labels); `$3` somewhere that matters. What stays put is drawn the same, in the same place, from frame to frame.
- `bg`: the ground (default `$1`). Lint reports malformed sketches as errors.

## Workflow (do this, in order)

1. Read `docs/motion.md` (the house numbers), `scene.json`, your brief, `style.md`, and run `npm run anim -- timing videos/<video> --scene <scene>` to see your exact span, its narration, and the cue times.
2. Write your section file.
3. `npm run anim -- lint videos/<video>`: fix every **error** that mentions your section (warnings are advice). Errors in other sections are not yours.
4. `npm run anim -- sheet videos/<video> --scene <scene> --section <sectionId>` → Read the PNG it prints. This is your eyes. Use `--every 0.5` for a denser look, or `frame --t <seconds>` for one full-size frame.
5. Critique against the rubric, patch, repeat steps 3–5. **Maximum 3 rounds**, then stop.

## Rubric

- **Narration fit:** each visual beat lands on its cue; the picture shows what the words say.
- **Hierarchy:** one focal point at a time; the eye knows where to look.
- **Readability:** text is big enough, on screen long enough, never overlapping shapes it fights with.
- **Composition:** balanced, aligned, inside the safe area, uses the empty space intentionally.
- **Motion:** purposeful, staggered groups, no dead air > 2.5s, nothing frantic; held things stay alive; shapes overshoot, UI only eases (numbers: `docs/motion.md`).
- **Style:** follows `style.md` (colors mean what they're supposed to mean).
- **Contract:** lint has zero errors for your section; you end exactly on your key.
