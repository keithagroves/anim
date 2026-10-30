# Theme and backdrop

Each video has a `theme.json`, merged over the engine defaults (`src/engine/theme.ts`). Use it for:
- the palette, i.e. colour tokens like `bg`, `text` and `muted`, plus the video's own tokens such as `task` or `judge`
- the backdrop: the stage painted behind every scene

## Backdrop

The backdrop sits outside the camera, so a `drift` push-in doesn't move it. Its parts are painted in this order:

1. **Fill:** flat `bg`, or a gradient from `bg` to another colour.
2. **Glows:** soft coloured light, optionally drifting slowly.
3. **Pattern:** a repeating texture, optionally panning.
4. The scene itself.
5. **Grain and vignette:** painted over the scene, like a lens.

Any motion (glow drift, pattern pan) is a pure function of the frame time. Seeking, parallel rendering and seam checks all stay exact.

### Presets

Give a preset name to get a ready-made look:

```json
{ "palette": { "...": "..." }, "backdrop": "aurora" }
```

| preset | look | suits |
|---|---|---|
| `dots` | flat navy, faint dot grid (the default) | anything; neutral |
| `grid` | flat navy, square grid | diagrams, architecture |
| `none` | flat `bg` only | busy scenes, footage |
| `lines` | diagonal hatch over a gentle gradient | documents, reports, writing |
| `cross` | sparse + marks, radial lift in the centre | data, measurement, results |
| `blueprint` | deep blue, minor/major grid that pans slowly | engineering, systems, how-it's-built |
| `aurora` | two drifting accent glows, no pattern | AI, ideas, concepts, intros |
| `spotlight` | bright centre, heavy vignette | one hero object, reveals |
| `dusk` | navy-to-plum gradient, warm glow from below | stories, history, people |

To see them all on a real frame of your video, run:

```
anim sheet videos/<name> --scene <id> --backdrops [--times 12.5]
```

You can also pick one when scaffolding: `anim new explainer videos/<name> --backdrop blueprint`.

### Custom

You can write an object instead of a preset name. It can start from a preset and override any field:

```json
"backdrop": {
  "preset": "aurora",
  "glows": [
    { "color": "task",  "x": 0.15, "y": 0.25, "r": 0.4, "opacity": 0.2, "drift": 50, "period": 26 },
    { "color": "judge", "x": 0.85, "y": 0.75, "r": 0.5, "opacity": 0.18 }
  ],
  "vignette": 0.6
}
```

| field | meaning |
|---|---|
| `pattern` | `none` `dots` `grid` `lines` `cross` `blueprint` |
| `spacing` | pattern cell in px (dots 36, grid 72, lines 28, cross 72, blueprint 24 minor / ×5 major) |
| `color` | pattern colour token or hex (default `line`) |
| `opacity` | pattern opacity 0–1 (default 0.55) |
| `pan` | pattern scroll `[x, y]` in px/s |
| `gradient` | `{ "to": "surface2", "angle": 90 }` (linear; 0 = left→right, 90 = top→bottom) or `{ "to": "...", "type": "radial" }` (bright centre) |
| `glows` | list of `{ color, x, y, r, opacity?, drift?, period? }`: `x`, `y` are 0–1 of the frame; `r` is a fraction of the width; `drift` is a wander amplitude in px; `period` is the loop length in seconds |
| `grain` | film grain 0–1 (off by default; noise doesn't compress, so even 0.3 made a 2-minute video ~4× larger) |
| `vignette` | edge darkening 0–1 (default 0.45; 0 turns it off) |

Unknown presets, patterns or out-of-range values are reported by `anim lint`.

### Tips

- **One look per video.** Pick the preset that matches the subject, not the one the last video used.
- **Glows carry meaning.** Colour them with the video's own tokens (`task`, `judge`), so the stage echoes the story's colours.
- **Keep it quiet.** The backdrop should never compete with the hero. If text starts to fight it, lower `opacity` or the glow `opacity`.
- **Contrast checks.** Lint checks text against `bg` and against a gradient's far end, so a bright `gradient.to` will show up as `contrast` warnings.
- **Light themes.** These need more than the backdrop: also override `bg`, `text`, `muted`, `surface`, `surface2` and `line` in the palette.
