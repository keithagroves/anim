// Pitches, chord symbols and voicings.

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "F#4" | "Bb2" | 62 → MIDI note number. */
export function midi(p: string | number): number {
  if (typeof p === "number") return p;
  const m = p.match(/^([A-Ga-g])([#b]*)(-?\d)$/);
  if (!m) throw new Error(`bad pitch "${p}" (use e.g. "F#4", "Bb2" or a MIDI number)`);
  const acc = [...m[2]].reduce((a, c) => a + (c === "#" ? 1 : -1), 0);
  return 12 * (Number(m[3]) + 1) + STEP[m[1].toUpperCase()] + acc;
}

export const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

const QUALITY: Record<string, number[]> = {
  "": [0, 4, 7], maj: [0, 4, 7], m: [0, 3, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], sus: [0, 5, 7], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], "6/9": [0, 4, 7, 9, 14], "69": [0, 4, 7, 9, 14],
  "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], "7sus4": [0, 5, 7, 10],
  "9": [0, 4, 7, 10, 14], maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], m11: [0, 3, 7, 10, 14, 17],
  "11": [0, 4, 7, 10, 14, 17], "13": [0, 4, 7, 10, 14, 21], maj13: [0, 4, 7, 11, 14, 21],
};

export interface Chord { root: number; bass: number; tones: number[] }

/** "Dmaj9", "Bm7", "G/B", "A6" → root pitch class, bass pitch class and intervals. */
export function chord(sym: string): Chord {
  const m = sym.match(/^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/);
  if (!m || !(m[2] in QUALITY)) throw new Error(`bad chord "${sym}" (qualities: ${Object.keys(QUALITY).filter(Boolean).join(" ")})`);
  const pc = (s: string) => ((midi(`${s}4`) % 12) + 12) % 12;
  return { root: pc(m[1]), bass: pc(m[3] ?? m[1]), tones: QUALITY[m[2]] };
}

/**
 * Close voicing folded into [lo, lo + 19] semitones, so consecutive chords move by small steps
 * (cheap voice leading) instead of jumping with the root.
 */
export function voicing(c: Chord, lo = 52): number[] {
  const out = c.tones.map((iv) => {
    let n = c.root + iv;
    while (n < lo) n += 12;
    while (n >= lo + 19) n -= 12;
    return n;
  });
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Bass note for a chord in [lo, lo + 12). */
export function bassNote(c: Chord, lo = 33): number {
  let n = c.bass;
  while (n < lo) n += 12;
  return n;
}
