# Picking a look

Every explainer up to `deepresearcheval` used the default `dots` backdrop and the default navy palette, so they all looked alike. A look is chosen for **this** video, before anything is drawn, and written into `style.md` and `theme.json`. These rules are adapted from the questions Claude Motion asks before it draws.

## 1. Offer three or four looks

Each look is a **name of one to three words** and **one line of at most 12 words** that anyone can picture: what is on screen, what it is made of or lit by, how it moves. Only what shapes, line, type, texture and light can do: nothing photo-real, no 3D, no acted characters.

- Make them from this video's subject, its audience and the words of the request. Never a stock list ("Modern", "Playful", "Bold"), never design jargon, never a look that would suit any other video as well.
- Distinct directions, not versions of one idea: a material, a place, a way of moving, a way of drawing, a scale, a point of view. No two of one kind.
- The first is the one you would make unasked: the look that best suits this audience.
- No colour names in a look: colours are the palette's job (below).
- The video shows a product, screenshots or a logo: every look frames them, none restyles them.
- No studio's, artist's or brand's name.

Example, for a video about a bell foundry (copy the form, never these names or lines):
- **Cast bronze**: heavy metal shapes lit by furnace glow, rising slowly into place
- **Sound rings**: each bell stroke sends thin rings rippling out across the screen
- **Inside the bell**: looking out of the bell's mouth as flat rooftops sway past

Ask the person to pick one, or pick the first yourself when nobody is there to ask (a pipeline run).

## 2. Offer a palette or two

Four colours in role order, mapped to our tokens:

| role | token | job |
|---|---|---|
| ground | `bg` | behind everything |
| main | the hero token (e.g. `hero`, `plugin`) | the video's chief colour, for shapes, plain on the ground |
| ink | `text` | words: at least 4.5 : 1 against `bg` |
| accent | `accent` | one touch here and there, one job |

Derive `surface`, `surface2`, `line` and `muted` from these (mixes of `bg` and `text`), never new unrelated hues.

- **Their colours first.** A brand they gave (logo, site, design tokens) is the first palette. Then at most two of yours.
- **Grounds:** at most one near-black and one near-white among the options. Any other ground is plainly a colour (wine, pine, cobalt, plum, petrol; or lemon, sky, rose, mint, apricot), never half-way (terracotta, olive, mid grey) where no ink reads.
- **A dark and a light** option in the row.
- **Main colours:** no two of one family (red, orange, yellow, green, blue, violet, pink, grey) across the options.
- Look along the row: change any palette that could be mistaken for another.
- Not only black, red and white or cream, unless they asked for it.

## 3. Pick the stage

Choose a backdrop preset that fits the look (`docs/theme.md`), and colour its glows with the video's own tokens. Compare them on a real frame:

```
anim sheet <video> --scene <id> --backdrops
```

## 4. Ask the length, and where it will be watched

Motion asks exactly three things before it draws (Style, Colors, Length), and its storyboard adds a fourth:

- **Length**, always: the seconds they want (else what suits the film). It sets the narration's length and the number of sections, about one per 10–15 s for an explainer.
- **Where it will be watched**, when it isn't obvious: slides or a doc; Slack or email (watched muted: one short on-screen line a scene carries the story); a social feed (the same, and vertical: a second video, never a resize); a website loop (no sound, the last frame eases back into the first).
- Never ask about the story (who, what happens, the message, the ending): that is the storyboard's, and the person changes it there. Ask once; what they leave open, you decide.

## 5. Write it down

- `style.md`: the look's name and line, the mood, what each colour means (one meaning each), the motion personality, and the don'ts. Agents read it for every section.
- `theme.json`: the palette tokens and the backdrop.

Everything shown must be fit to show coworkers of every background: nothing that reads as a flag, emblem, propaganda poster or a party's, army's or faith's symbol beyond what the subject needs.
