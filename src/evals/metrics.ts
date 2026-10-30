import { loadVideo } from "../cli/load.js";
import type { Issue } from "../engine/lint.js";

export interface SectionMetrics {
  /** Gate: compiles, no errors attributed to the section, scope respected. */
  gate: boolean;
  compiles: boolean;
  exists: boolean;
  errors: number;
  warnings: number;
  errorsByRule: Record<string, number>;
  warningsByRule: Record<string, number>;
  errorMessages: string[];
  seamOk: boolean;
  /** Share of this section's cues that have an animation starting within 0.6s. */
  cueCoverage: number | null;
  cues: number;
  /** Longest stretch inside the section with nothing animating (s). */
  maxGap: number;
  entries: number;
  anims: number;
  localObjects: number;
  span: { start: number; end: number } | null;
  /** Files other than the section that changed (set by the harness). */
  scopeViolations: string[];
}

const mentions = (text: string, sec: string) =>
  text.startsWith(`${sec}.`) || text.startsWith(`${sec}:`) || text.includes(`"${sec}.`) || text.startsWith(`${sec} `);

/** Deterministic grade of one section of one scene in a video folder. */
export function sectionMetrics(video: string, sceneId: string, section: string, scopeViolations: string[] = []): SectionMetrics {
  const v = loadVideo(video);
  const s = v.scenes.find((x) => x.id === sceneId);
  const empty: SectionMetrics = {
    gate: false, compiles: false, exists: false, errors: 1, warnings: 0, errorsByRule: {}, warningsByRule: {}, errorMessages: [],
    seamOk: false, cueCoverage: null, cues: 0, maxGap: 0, entries: 0, anims: 0, localObjects: 0, span: null, scopeViolations,
  };
  if (!s) return { ...empty, errorMessages: [`scene ${sceneId} not found`, ...v.errors] };

  // Compile errors that belong to this section (file parse errors or messages naming it).
  const compileErrors = s.errors.filter((e) => e.includes(`sections/${section}.json`) || mentions(e, section));
  const otherCompileErrors = s.errors.filter((e) => !compileErrors.includes(e));
  const issues: Issue[] = s.issues.filter((i) => i.section === section);
  const errorsByRule: Record<string, number> = {}, warningsByRule: Record<string, number> = {};
  for (const i of issues) {
    const m = i.level === "error" ? errorsByRule : warningsByRule;
    m[i.rule] = (m[i.rule] ?? 0) + 1;
  }
  if (compileErrors.length) errorsByRule.compile = compileErrors.length;
  const errors = compileErrors.length + issues.filter((i) => i.level === "error").length;

  const c = s.scene;
  const k = c ? c.spans.findIndex((x) => x.id === section) : -1;
  const exists = !!c && k >= 0 && c.anims[k] !== undefined && c.anims[k].length > 0;
  let cueCoverage: number | null = null, cues = 0, maxGap = 0, entries = 0, anims = 0, localObjects = 0;
  let span: SectionMetrics["span"] = null;
  if (c && k >= 0) {
    const sp = c.spans[k];
    span = { start: sp.start, end: sp.end };
    const list = c.anims[k] ?? [];
    anims = list.length;
    entries = new Set(list.map((a) => a.entry)).size;
    localObjects = Object.values(c.objects).filter((o) => o.owner === k).length;
    const inSpan = Object.values(c.cues).filter((t) => t >= sp.start && t < sp.end);
    cues = inSpan.length;
    if (cues) cueCoverage = inSpan.filter((t) => list.some((a) => Math.abs(a.start - t) < 0.6)).length / cues;
    const iv = list.map((a) => [Math.max(a.start, sp.start), Math.min(a.start + a.dur, sp.end)] as const).sort((a, b) => a[0] - b[0]);
    let cursor = sp.start;
    for (const [a, b] of iv) { maxGap = Math.max(maxGap, a - cursor); cursor = Math.max(cursor, b); }
    maxGap = Math.max(maxGap, sp.end - cursor);
  }
  const seamOk = !issues.some((i) => i.rule === "seam" && i.level === "error");
  const compiles = !!c && compileErrors.length === 0;
  return {
    gate: compiles && exists && errors === 0 && scopeViolations.length === 0,
    compiles, exists, errors, warnings: issues.filter((i) => i.level === "warn").length,
    errorsByRule, warningsByRule,
    errorMessages: [...compileErrors, ...issues.filter((i) => i.level === "error").map((i) => `[${i.rule}] ${i.where}: ${i.message}`), ...otherCompileErrors.map((e) => `(other) ${e}`)].slice(0, 20),
    seamOk, cueCoverage, cues, maxGap: Math.round(maxGap * 100) / 100, entries, anims, localObjects, span, scopeViolations,
  };
}
