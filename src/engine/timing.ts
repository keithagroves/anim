import type { Words } from "./types.js";

const WORD = /[A-Za-z0-9]/;

/**
 * Snap each target section boundary to the best nearby pause in the narration.
 * Candidates sit between a token and the next spoken word; sentence ends score highest.
 */
export function splitSections(
  targets: [number, number][],
  duration: number,
  words: Words["words"] | undefined,
  window = 2.5,
): { start: number; end: number }[] {
  const n = targets.length;
  const bounds: number[] = [0];
  for (let i = 1; i < n; i++) {
    const want = targets[i][0];
    let best = want, bestScore = -Infinity;
    if (words?.length) {
      for (let j = 0; j < words.length - 1; j++) {
        const cur = words[j], next = words[j + 1];
        if (!WORD.test(next.text)) continue;
        const punct = /[.!?]/.test(cur.text) ? 3 : /[,;:—–]/.test(cur.text) ? 1.5 : 0.2;
        const gap = Math.max(0, next.start - cur.end);
        const t = next.start - Math.min(0.15, gap / 2 + 0.05);
        const dev = Math.abs(t - want);
        if (dev > window || t <= bounds[i - 1] + 1) continue;
        const score = punct + gap * 4 - dev * 0.8;
        if (score > bestScore) { bestScore = score; best = t; }
      }
    }
    bounds.push(Math.round(best * 1000) / 1000);
  }
  bounds.push(duration);
  return targets.map((_, i) => ({ start: bounds[i], end: bounds[i + 1] }));
}

export function globToRegex(glob: string): RegExp {
  return new RegExp("^" + glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
}

/**
 * Picture time strings, the score's grammar without beat snaps:
 * "cue:name" | "start" | "end" (of this section) | "<sectionId>" | "<sectionId>.end", then any "+0.5" / "-0.6" offsets.
 */
export function resolveTime(
  x: string,
  ctx: { start: number; end: number; cues: Record<string, number>; spans: { id: string; start: number; end: number }[] },
): number {
  const m = /^(cue:[\w-]+|start|end|[A-Za-z][\w-]*(?:\.end)?)((?:\s*[+-]\s*[\d.]+)*)$/.exec(x.trim());
  if (!m) throw new Error(`time "${x}" must be seconds, "cue:name", "start", "end", "<section>" or "<section>.end", with optional +/- seconds (e.g. "end-0.6")`);
  const [, base, offs] = m;
  let t: number;
  if (base.startsWith("cue:")) {
    const c = ctx.cues[base.slice(4)];
    if (c === undefined) throw new Error(`unknown cue "${base.slice(4)}" (have: ${Object.keys(ctx.cues).join(", ") || "none — run anim voice"})`);
    t = c;
  } else if (base === "start") t = ctx.start;
  else if (base === "end") t = ctx.end;
  else {
    const isEnd = base.endsWith(".end"), id = isEnd ? base.slice(0, -4) : base;
    const sp = ctx.spans.find((s) => s.id === id);
    if (!sp) throw new Error(`time "${x}": unknown section "${id}" (have: ${ctx.spans.map((s) => s.id).join(", ")})`);
    t = isEnd ? sp.end : sp.start;
  }
  for (const o of offs.matchAll(/([+-])\s*([\d.]+)/g)) t += (o[1] === "-" ? -1 : 1) * Number(o[2]);
  return t;
}
