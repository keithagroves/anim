import type { BackdropInput } from "./backdrop.js";

export interface TextStyle { size: number; weight: number; font?: "sans" | "mono"; fill?: string }

export interface Theme {
  palette: Record<string, string>;
  fonts: { sans: string; mono: string };
  text: Record<string, TextStyle>;
  space: Record<string, number>;
  radius: Record<string, number>;
  stroke: Record<string, number>;
  timing: { fast: number; base: number; slow: number; scale: number };
  safe: number;
  /** A preset name or a spec object; see backdrop.ts. */
  backdrop: BackdropInput;
  /** Palette tokens behind storyboard sketch roles $1..$5 (ground, main, second, accent, light spare); see sketch.ts. */
  roles?: string[];
}

export const DEFAULT_THEME: Theme = {
  palette: {
    bg: "#0b1020",
    surface: "#141b31",
    surface2: "#1c2544",
    line: "#2d3a63",
    text: "#e9edf9",
    muted: "#8b95b9",
    accent: "#4f8cff",
    accent2: "#8b6cff",
    good: "#2fd18b",
    warn: "#ffb547",
    bad: "#ff5d6c",
  },
  fonts: { sans: "Inter Variable", mono: "JetBrains Mono Variable" },
  text: {
    h1: { size: 96, weight: 750 },
    h2: { size: 64, weight: 700 },
    h3: { size: 44, weight: 650 },
    body: { size: 36, weight: 450 },
    caption: { size: 34, weight: 500, fill: "muted" },
    label: { size: 28, weight: 600 },
    small: { size: 22, weight: 500, fill: "muted" },
    mono: { size: 30, weight: 500, font: "mono" },
    stat: { size: 120, weight: 800 },
  },
  space: { xs: 8, sm: 16, md: 32, lg: 64, xl: 112 },
  radius: { sm: 8, md: 16, lg: 28 },
  stroke: { thin: 2, md: 4, bold: 6 },
  timing: { fast: 0.35, base: 0.6, slow: 1.0, scale: 1 },
  safe: 96,
  backdrop: "dots",
};

export function mergeTheme(base: Theme, over: any): Theme {
  if (!over) return base;
  const out: any = structuredClone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object") out[k] = { ...out[k], ...(v as any) };
    else out[k] = v;
  }
  return out;
}

/** Resolve a color token ("accent") or pass through a literal ("#fff", "none"). */
export function color(theme: Theme, c: string | undefined, fallback = "none"): string {
  if (c === undefined) return fallback;
  return theme.palette[c] ?? c;
}

/** Resolve a size token from one of the theme scales, or pass a number through. */
export function size(theme: Theme, scale: "space" | "radius" | "stroke", v: number | string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === "number") return v;
  const hit = theme[scale][v];
  if (hit === undefined) throw new Error(`unknown ${scale} token "${v}" (have: ${Object.keys(theme[scale]).join(", ")})`);
  return hit;
}
