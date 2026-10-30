import type { Theme } from "./theme.js";

/**
 * The stage behind every scene: a fill (flat or gradient), soft glows, a repeating pattern,
 * film grain and a vignette. It sits outside the camera, so it never moves with a push-in.
 * Everything that moves (pattern pan, glow drift) is a pure function of the frame time.
 */

export type Pattern = "none" | "dots" | "grid" | "lines" | "cross" | "blueprint";
export const PATTERNS: Pattern[] = ["none", "dots", "grid", "lines", "cross", "blueprint"];

export interface Glow {
  /** Colour token or hex. */
  color: string;
  /** Centre as a fraction of the frame (0–1). */
  x: number;
  y: number;
  /** Radius as a fraction of the frame width. */
  r: number;
  opacity?: number;
  /** Slow wander: amplitude in px and loop length in seconds. */
  drift?: number;
  period?: number;
}

export interface BackdropSpec {
  pattern: Pattern;
  /** Pattern cell size in px (defaults per pattern). */
  spacing?: number;
  /** Pattern colour token or hex (default `line`). */
  color?: string;
  /** Pattern opacity (default 0.55). */
  opacity?: number;
  /** Pattern scroll in px/s, [x, y]. */
  pan?: [number, number];
  /** Fill from `bg` to `to`. Linear at `angle` degrees (0 = left→right, 90 = top→bottom), or radial from the centre. */
  gradient?: { to: string; angle?: number; type?: "linear" | "radial" };
  glows?: Glow[];
  /** Film grain strength, 0–1. Off in every preset: it makes the encoded video several times larger. */
  grain?: number;
  /** Edge darkening, 0–1 (default 0.45). */
  vignette?: number;
}

/** What theme.json accepts: a preset name, or an object (optionally starting from a preset). */
export type BackdropInput = string | (Partial<BackdropSpec> & { preset?: string });

export const BACKDROP_PRESETS: Record<string, BackdropSpec> = {
  none: { pattern: "none" },
  dots: { pattern: "dots" },
  grid: { pattern: "grid" },
  lines: { pattern: "lines", opacity: 0.6, spacing: 32, gradient: { to: "surface2", angle: 100 } },
  cross: { pattern: "cross", opacity: 0.6, gradient: { to: "surface", type: "radial" } },
  blueprint: {
    pattern: "blueprint", color: "accent", opacity: 0.22, pan: [6, 3],
    gradient: { to: "#0d1f45", angle: 120 }, vignette: 0.55,
  },
  aurora: {
    pattern: "none", vignette: 0.5,
    glows: [
      { color: "accent", x: 0.18, y: 0.2, r: 0.42, opacity: 0.22, drift: 60, period: 24 },
      { color: "accent2", x: 0.85, y: 0.8, r: 0.48, opacity: 0.2, drift: 70, period: 30 },
    ],
  },
  spotlight: { pattern: "dots", opacity: 0.3, gradient: { to: "surface2", type: "radial" }, vignette: 0.65 },
  dusk: {
    pattern: "dots", opacity: 0.35, gradient: { to: "#2b1838", angle: 90 },
    glows: [{ color: "warn", x: 0.5, y: 1.1, r: 0.55, opacity: 0.2, drift: 30, period: 40 }],
  },
};

const DEFAULT_SPACING: Record<Pattern, number> = { none: 0, dots: 36, grid: 72, lines: 28, cross: 72, blueprint: 24 };

/** Resolve theme.backdrop into a full spec, collecting problems instead of throwing. */
export function resolveBackdrop(input: unknown, errors: string[] = []): BackdropSpec {
  if (input === undefined || input === null) return BACKDROP_PRESETS.dots;
  if (typeof input === "string") {
    const p = BACKDROP_PRESETS[input];
    if (!p) errors.push(`theme.json: unknown backdrop "${input}" (have: ${Object.keys(BACKDROP_PRESETS).join(", ")})`);
    return p ?? BACKDROP_PRESETS.dots;
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push(`theme.json: backdrop must be a preset name or an object`);
    return BACKDROP_PRESETS.dots;
  }
  const { preset, ...over } = input as Partial<BackdropSpec> & { preset?: string };
  let base: BackdropSpec = { pattern: "none" };
  if (preset !== undefined) {
    if (BACKDROP_PRESETS[preset]) base = BACKDROP_PRESETS[preset];
    else errors.push(`theme.json: unknown backdrop preset "${preset}" (have: ${Object.keys(BACKDROP_PRESETS).join(", ")})`);
  }
  const spec = { ...base, ...over } as BackdropSpec;
  if (!PATTERNS.includes(spec.pattern)) {
    errors.push(`theme.json: unknown backdrop pattern "${spec.pattern}" (have: ${PATTERNS.join(", ")})`);
    spec.pattern = "none";
  }
  for (const k of ["grain", "vignette", "opacity"] as const) {
    const v = spec[k];
    if (v !== undefined && (typeof v !== "number" || v < 0 || v > 1)) errors.push(`theme.json: backdrop.${k} must be a number from 0 to 1`);
  }
  for (const [i, g] of (spec.glows ?? []).entries()) {
    if (!g || typeof g.color !== "string" || ![g.x, g.y, g.r].every((v) => typeof v === "number"))
      errors.push(`theme.json: backdrop.glows[${i}] needs color, x, y and r`);
  }
  return spec;
}

const n = (v: number) => (Math.round(v * 100) / 100).toString();

/** SVG for the backdrop: `defs` go in <defs>, `under` paints before the scene, `over` after it. */
export function paintBackdrop(th: Theme, W: number, H: number, t: number, prefix: string): { defs: string; under: string; over: string } {
  const spec = resolveBackdrop(th.backdrop);
  const col = (c: string | undefined, fb: string) => (c === undefined ? fb : th.palette[c] ?? c);
  const bg = th.palette.bg;
  const defs: string[] = [];
  const under: string[] = [];

  // fill
  if (spec.gradient) {
    const to = col(spec.gradient.to, bg);
    const id = `${prefix}-bgg`;
    if (spec.gradient.type === "radial") {
      defs.push(`<radialGradient id="${id}" cx="50%" cy="45%" r="70%"><stop offset="0%" stop-color="${to}"/><stop offset="100%" stop-color="${bg}"/></radialGradient>`);
    } else {
      const a = ((spec.gradient.angle ?? 90) * Math.PI) / 180;
      const dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
      defs.push(`<linearGradient id="${id}" x1="${n(0.5 - dx)}" y1="${n(0.5 - dy)}" x2="${n(0.5 + dx)}" y2="${n(0.5 + dy)}"><stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="${to}"/></linearGradient>`);
    }
    under.push(`<rect width="${W}" height="${H}" fill="url(#${id})"/>`);
  } else {
    under.push(`<rect width="${W}" height="${H}" fill="${bg}"/>`);
  }

  // glows
  for (const [i, g] of (spec.glows ?? []).entries()) {
    const id = `${prefix}-glow${i}`;
    const c = col(g.color, th.palette.accent);
    const period = g.period ?? 30, amp = g.drift ?? 0;
    const ph = (2 * Math.PI * t) / period + i * 1.7;
    const cx = g.x * W + amp * Math.sin(ph), cy = g.y * H + amp * 0.6 * Math.cos(ph * 0.8);
    defs.push(`<radialGradient id="${id}"><stop offset="0%" stop-color="${c}" stop-opacity="${n(g.opacity ?? 0.2)}"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient>`);
    under.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(g.r * W)}" fill="url(#${id})"/>`);
  }

  // pattern
  if (spec.pattern !== "none") {
    const s = spec.spacing ?? DEFAULT_SPACING[spec.pattern];
    const c = col(spec.color, th.palette.line);
    const id = `${prefix}-pat`;
    const [px, py] = spec.pan ?? [0, 0];
    const big = spec.pattern === "blueprint" ? s * 5 : s; // the tile repeats every major line
    const ox = ((px * t) % big + big) % big, oy = ((py * t) % big + big) % big;
    const tf = ox || oy ? ` patternTransform="translate(${n(ox)} ${n(oy)})"` : "";
    let cell = "";
    switch (spec.pattern) {
      case "dots": cell = `<circle cx="${n(s / 2)}" cy="${n(s / 2)}" r="1.4" fill="${c}"/>`; break;
      case "grid": cell = `<path d="M${s} 0H0V${s}" fill="none" stroke="${c}" stroke-width="1" opacity="0.6"/>`; break;
      case "lines": cell = `<path d="M0 ${s}L${s} 0M${-s / 2} ${s / 2}L${s / 2} ${-s / 2}M${s / 2} ${s * 1.5}L${s * 1.5} ${s / 2}" stroke="${c}" stroke-width="1"/>`; break;
      case "cross": { const m = s / 2, k = 5; cell = `<path d="M${m - k} ${m}H${m + k}M${m} ${m - k}V${m + k}" stroke="${c}" stroke-width="1.5"/>`; break; }
      case "blueprint": {
        const minor = Array.from({ length: 5 }, (_, i) => `M${i * s} 0V${big}M0 ${i * s}H${big}`).join("");
        cell = `<path d="${minor}" stroke="${c}" stroke-width="0.75" opacity="0.5" fill="none"/><path d="M0 0V${big}M0 0H${big}" stroke="${c}" stroke-width="1.5" fill="none"/>`;
        break;
      }
    }
    defs.push(`<pattern id="${id}" width="${big}" height="${big}" patternUnits="userSpaceOnUse"${tf}>${cell}</pattern>`);
    under.push(`<rect width="${W}" height="${H}" fill="url(#${id})" opacity="${n(spec.opacity ?? 0.55)}"/>`);
  }

  // grain and vignette paint over the scene, like a lens
  const over: string[] = [];
  if (spec.grain) {
    // Noise is computed once on a small seamless tile and repeated, not filtered across the full frame.
    // It's still costly in the encoded file (noise doesn't compress), so presets leave it off.
    const id = `${prefix}-grain`, T = 256;
    defs.push(
      `<filter id="${id}-f" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/>` +
      `<feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 ${n(spec.grain * 0.28)}"/></feComponentTransfer></filter>` +
      `<pattern id="${id}" width="${T}" height="${T}" patternUnits="userSpaceOnUse"><rect width="${T}" height="${T}" filter="url(#${id}-f)"/></pattern>`,
    );
    over.push(`<rect width="${W}" height="${H}" fill="url(#${id})" pointer-events="none"/>`);
  }
  const vig = spec.vignette ?? 0.45;
  if (vig > 0) {
    defs.push(`<radialGradient id="${prefix}-vig" cx="50%" cy="45%" r="75%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="${n(vig)}"/></radialGradient>`);
    over.push(`<rect width="${W}" height="${H}" fill="url(#${prefix}-vig)" pointer-events="none"/>`);
  }
  return { defs: defs.join(""), under: under.join(""), over: over.join("") };
}

/** The flat colours the backdrop spans (the fill, plus a gradient's far end), for contrast checks. */
export function backdropTones(th: Theme): string[] {
  const spec = resolveBackdrop(th.backdrop);
  const tones = [th.palette.bg];
  if (spec.gradient) tones.push(th.palette[spec.gradient.to] ?? spec.gradient.to);
  return tones;
}
