# Score format reference (music + foley)

A scene can have a **score**: `scenes/<scene>/score.json`. It is declarative data written against the **same timeline as the picture**: narration cues, section starts, and the animations themselves. `anim score <video>` compiles it, synthesizes it (a small built-in synth, no samples), ducks it under the narration and writes:

- `score.wav`: the music alone
- `mix.wav`: narration + music. Preview and `anim render` use it automatically while it is newer than `vo.wav` and `score.json`.

Same file, same seed → same samples. Re-run `anim score` after changing the narration or the score.

## Method

1. **Tempo from the cut.** Use `"tempo": { "fit": ["s2", "s3", "s4"] }`. The tool searches the BPM (default 84–112) and phase that put grid lines closest to those anchors and prints how far off each one lands. Narration-led cuts rarely line up with bar lines, so `"unit": "beat"` (anchors on beats) usually fits within a frame or two. Start each section's music at `"sN~beat"`, so its pattern's first downbeat *is* the cut. Aim for every anchor within about ±60 ms.
2. **Groove on the grid, foley on exact frames.** Use patterns and progressions for music. Use `"foley": true` for UI sounds: it derives them from the picture's own animations. Add one-off `fx` at exact cues.
3. **Keep the arc.** The shape, start to finish (Claude Motion's scores follow it, and so should ours):
   - **title**: a near-silent pad, or one soft chord, under the first line (frame 0 is the thumbnail, so time it for 0);
   - **pulse**: a light figure (mallet or plucked ostinato) as the subject arrives;
   - **groove**: bass and a light kit enter on the first big beat, on a downbeat;
   - **build**: a `run` or `revswell` *into* the last section;
   - **the hit**: a crash, a kick and a held chord exactly where the end card lands, on a downbeat;
   - **ring out** over the ≥ 3 s end hold, with `master.fadeOut` 1.2–1.4.

   Then run `anim score <video> --levels` and check the numbers (RMS dBFS before ducking):

   | moment | target |
   |---|---|
   | title | near-silent pad, about −30 |
   | groove | about −20 |
   | breakdown | 4–6 dB below the groove |
   | the hit | the loudest moment |

   No second between the title and the sign-off should sit below −30. A short stop-time (one empty beat) before the hit is free drama.
4. **Your own tune.** Write original melodies. A genre, mood, tempo or instrument is fine; an existing song's melody is not.
5. **One grid, one progression.** A `progression` starts on its first chord at its own `from`, and patterns and drums count bars from their own `from`. If one track restarts mid-piece (say, keys and bass at `s5~beat`) while the pad keeps cycling, the chords clash and the downbeats drift apart. Start every layer on a bar line (`"bar:N"`, or `"unit": "bar"` in the fit so the cuts land on bars). When you split a progression to change a part's rhythm or level, rotate its chord list so the new event begins on the chord the shared cycle is on. Keep foley for sparse beats: a staggered grid of 40 `pop`s becomes a rising squeal, so map it to `none` and place the few sounds that matter by hand.
6. **Intelligibility.** `anim eval voice` transcribes `mix.wav` too. If "wer under music" fails, duck deeper (`master.duck`) or thin the arrangement under speech.

## File

```json
{
  "seed": 11,
  "meter": 4,
  "tempo": { "fit": ["s2", "s3", "s4", "s5"], "range": [86, 112], "unit": "beat" },
  "programs": {
    "keys": { "patch": "ep", "gain": -2, "pan": -0.15 },
    "bass": "bass",
    "mallet": { "patch": "marimba", "gain": -4, "pan": 0.25, "rev": 0.3 }
  },
  "foley": { "vel": 44, "map": { "draw-on": "swish" } },
  "events": [
    { "progression": ["Dmaj9", "Bm7", "Gmaj7", "A6"], "track": "keys", "from": "s2~beat", "to": "s4~beat", "rhythm": "x..x..x." },
    { "progression": ["Dmaj9", "Bm7", "Gmaj7", "A6"], "track": "bass", "part": "root", "from": "s2~beat", "to": "s4~beat", "rhythm": "x...x.x." },
    { "drums": { "kick": "x...x...", "sidestick": "....x...", "hat": "oxoxoxox" }, "from": "s3~beat", "to": "s4~beat-1b" },
    { "pattern": "x.x.X.xx", "track": "mallet", "from": "s3~beat", "to": "s4~beat", "pitch": ["D5", "A4", "F#5", "E5"] },
    { "run": ["D5", "E5", "F#5", "A5"], "track": "mallet", "at": "cue:end~beat-1b", "step": 0.09, "cresc": 8 },
    { "chord": "Dmaj9", "track": "keys", "at": "cue:end~beat", "beats": 6, "vel": 80, "over": true },
    { "fx": "chime", "at": "cue:saved" }
  ],
  "master": { "gain": -6, "fadeOut": 1.4, "duck": -15 }
}
```

## Times

Every `at` / `from` / `to` is seconds, or a string `base[~snap][offsets]`:

| part | forms |
|---|---|
| base | `cue:name` · `s3` (section start) · `s3.end` · `start` · `end` · `beat:16` · `bar:4` (from the grid's bar 0) |
| snap | `~beat` · `~half` · `~bar`: snap to the nearest grid line |
| offsets | `+0.5` seconds · `-1b` beats · `+2bar` bars (several allowed: `s4~beat-1b+0.05`) |

Patterns, drums and progressions fill **[from, to)** exactly, so they never overrun.

## Events

| event | fields |
|---|---|
| `note` | `note` ("F#4" or MIDI), `track`, `at`, `beats` or `dur` (s), `vel` 0–127 |
| `chord` | `chord`: a symbol ("Dmaj9", "Bm7", "G/B") or a list of pitches; `track`, `at`, `beats`/`dur`, `vel`, `strum` (s between notes), `octave` |
| `pattern` | `pattern` step string, `track`, `from`, `to`, `pitch` (one, or a list cycled per hit), `step` (beats per char, default 0.5 → 8 chars = a 4/4 bar), `vel`, `beats` (note length) |
| `drums` | `drums: { "kick": "x...x...", "hat": "oxox…" }`, `from`, `to`, `step`, `vel` |
| `drum` | one hit: `drum`, `at`, `vel` |
| `progression` | chord symbols, one per `bars` (default 1), cycled from `from` to `to`; `part`: `chord` (voiced, voice-led) · `root` (bass) · `fifths` · `arp` (one chord tone per hit, rising); `rhythm` step string per bar (default: held); `octave` |
| `run` | `run` (pitches), `track`, `at`, `step` (s), `vel`, `cresc` (vel added per note) |
| `fx` | `fx`, `at`, `dur`, `vel`, `pitch`, `pan` |

Step strings: `x` hit · `X` accent · `o` ghost · `.` rest · `-` holds the previous note. Spaces and `|` are ignored, so `"x..x|..x."` works.

`over: true` on a note, chord, drum, run or fx keeps it out of the ducking, so a hit cuts through narration. Use it sparingly.

**Chord qualities:** maj, m, dim, aug, sus2, sus4, add9, madd9, 6, m6, 69 (six-nine), 7, maj7, m7, m7b5, 7sus4, 9, maj9, m9, m11, 11, 13, maj13, plus slash bass (`G/B`).

## Sounds

- **Pitched patches** (the `programs` value, or a track named after one): `marimba`, `vibes`, `glock`, `pluck` (kalimba-like), `ep` (electric piano), `keys` (soft synth), `bass` (round, fingered), `pad`.
- **Program options:** `gain` (dB), `pan` (−1…1), `rev` (reverb send 0…1), `bright` (0…2).
- **Drums:** kick, snare, clap, sidestick, hat, openhat, shaker, tamb, woodblock, cowbell, tom, crash, ride.
- **Foley:** tick, click, doubleclick, pop, ding (two notes a fifth apart), chime (Save), sparkle, whoosh, revswell (swells *into* its time), swish, roll (accelerating ticks over `dur`, landing on a ding), boing, thud.

Unknown drum and fx names are errors. An unknown patch falls back to marimba, with a warning.

## Foley from the picture

`"foley": true` turns animations into sound, at their exact frames:

| preset | sound |
|---|---|
| `pop` / `pop-out` | pop (consecutive pops climb in pitch, so a staggered list plays as a little run) |
| `fly-from` | whoosh over the flight |
| `type-on` | one quiet tick per character |
| `count-up` | roll landing on a ding as the number lands |
| `wipe-in` | swish |

Override or extend the defaults with `map` (e.g. `{ "draw-on": "swish", "pop": "none" }`). `vel` sets the overall foley level.

Everything else is silent unless you map it. That includes the ambient presets (`breathe`, `sway`, `creep`, `drift`): they run under every hold, and a sound on each would be noise. `words-in`, `wobble` and `clear` are silent too. If a word-by-word title should tick, map it: `{ "words-in": "ticks" }`.

## Instrumentation that suits explainers and product films

Marimba or kalimba ostinatos, electric-piano chords, a round bass, a light kit (kick, side stick, closed hat, a shaker at most) and a soft pad. Major or modal, mid-tempo, warm. Avoid risers, cinematic booms and vocal chops.
