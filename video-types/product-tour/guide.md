# Product tour / changelog: what works

**Film the real thing.** `record.mts` drives the app with Playwright and records a WebM per shot:
- Use the **installed Chrome** (`channel: "chrome"`): Playwright's bundled Chromium can't play H.264, so hero videos turn into stills.
- **Block analytics** (GA/GTM) so recordings don't count as visits.
- **Hide dev overlays** (the Next.js badge) with an init-script style.
- **Recording size = viewport size.** The screencast is captured in CSS pixels; with deviceScaleFactor 2, a larger size only pads it with grey.
- **`mark()` each moment** (marks.json): those clip times become `start` values in the score and timeline.
- Smooth scroll with an eased rAF loop, passed to `evaluate` as a *string*: tsx injects `__name` into functions passed as code.
- Check stills (`ffmpeg -ss <t> -i clip.webm -frames:v 1`) before building on a clip.

**Edit with `play`.** One shared `video` object is the screen. Each section plays the clip segment it needs (`start`, `rate`, `dur`), timed to its cues: slow static shots (rate 0.6–0.8), keep scrolls near real time. A jump in clip time at a section boundary is a cut, and that's fine. Phone footage goes in a second `video` inside a bezel rect.

**Let the camera point** (the walkthrough numbers, `docs/motion.md` §7): each beat is ONE region, ONE action, at most one chip. `focus` the camera onto it (1.6–2.4×, 0.55–1.2 s, ease `arrive`), hold 1.4–2.2 s, dim the rest with a `spotlight` on it, and name it with a `chip` (≤ 6 words, ≥ 1.2 s on screen, beside it on a leader line). Go back out (`focus` `on: "full"`, ease `glide`) only to move to a distant region. A beat you can't label in four words is two beats.

**Point at the change:**
- A highlight ring is a no-fill rect placed `in` the screen. Measure it from a still: footage px × (window width / recording width).
- A callout card in a column beside the window, ≤ 6 words, one per beat.
- Work that isn't filmable yet (backend, payments) becomes a small flow diagram in the last section, labelled *in progress*.

**Score:** a warm product-film bed, a tempo fitted to the section starts (`unit: beat`), `foley: true`, and a hit marked `over: true` as the last diagram box lands. Check "wer under music" in `anim eval voice`.

**Pitfalls seen:**
- Footage text is small at 1280 wide: rings and callouts carry the message, so keep to one per beat.
- The narration can group changes under the wrong date: check each claim against the git log.
