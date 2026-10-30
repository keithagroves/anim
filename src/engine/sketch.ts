import { mixColor } from "./color.js";
import { color, type Theme } from "./theme.js";

/**
 * Storyboard sketches: a section's planned frame as 8–12 SVG paths in a
 * 96 × 54 box (54 × 96 for a vertical film). Paths are written in palette roles, not colours, so a new palette recolours every drawing.
 *
 *   "$2 M0 46h96v8h-96z"        fill in role 2 (main)
 *   "$4~2 M10 47q10 -3 20 0"    a line 2 wide (anything not closed needs the ~)
 *   "$2d …" / "$2l …"           role 2, 30 % darker / lighter
 *   "#ffffff33 …"               plain hex (with alpha) for what must never change: glows, shadows
 */
export interface Sketch { bg?: string; paths: string[] }

export const SKETCH_W = 96, SKETCH_H = 54;
/** The sketch box for a frame: 96 × 54, or 54 × 96 for a vertical film. */
export const sketchBox = (size: [number, number]): [number, number] => (size[1] > size[0] ? [SKETCH_H, SKETCH_W] : [SKETCH_W, SKETCH_H]);
const MAX_PATHS = 24, MAX_CHARS = 600, MAX_TOTAL = 4000;

/** Theme tokens behind $1..$5: ground, main, second, accent, light spare. A video can set `theme.roles`. */
export function sketchRoles(theme: Theme): string[] {
  return theme.roles ?? ["bg", "accent", "accent2", "text", "surface2"];
}

const PAINT = /^(\$([1-9])([dl])?|#[0-9a-fA-F]{3,8})(~(\d{1,2}(\.\d)?)?)?$/;
const PATH = /^[MLHVCSQTAZmlhvcsqtaz0-9 ,.\-]+$/;

export interface SketchPath { paint: string; line?: number; d: string }

/** Parse and check one sketch. Errors name the path (1-based) and what is wrong. */
export function parseSketch(sk: Sketch): { paths: SketchPath[]; errors: string[] } {
  const errors: string[] = [], paths: SketchPath[] = [];
  if (sk.paths.length > MAX_PATHS) errors.push(`${sk.paths.length} paths (at most ${MAX_PATHS}; 8–12 is the aim)`);
  const total = sk.paths.reduce((a, p) => a + p.length, 0);
  if (total > MAX_TOTAL) errors.push(`${total} characters (at most ${MAX_TOTAL})`);
  if (sk.bg !== undefined && !/^(\$[1-9][dl]?|#[0-9a-fA-F]{6})$/.test(sk.bg)) errors.push(`bg "${sk.bg}": a role ($1) or plain #rrggbb`);
  sk.paths.forEach((s, i) => {
    const at = s.indexOf(" ");
    const paint = at < 0 ? s : s.slice(0, at), d = at < 0 ? "" : s.slice(at + 1).trim();
    const m = PAINT.exec(paint);
    if (s.length > MAX_CHARS) errors.push(`path ${i + 1}: ${s.length} characters (at most ${MAX_CHARS})`);
    if (!m) { errors.push(`path ${i + 1}: paint "${paint}" should be a role ($2, $2d, $2l), or #hex, optionally ~width for a line`); return; }
    if (!d || !PATH.test(d)) { errors.push(`path ${i + 1}: the path may hold only M L H V C S Q T A Z, digits, spaces, commas, dots and minus`); return; }
    const line = m[4] !== undefined ? (m[5] !== undefined ? Number(m[5]) : 1.5) : undefined;
    if (line !== undefined && line > 12) errors.push(`path ${i + 1}: line width ${line} (at most 12)`);
    paths.push({ paint: m[1], line, d });
  });
  return { paths, errors };
}

/** A paint ($n, $nd, $nl or hex) as a concrete colour, plus its opacity for #rrggbbaa. */
export function sketchColor(paint: string, theme: Theme): { hex: string; opacity: number } {
  const m = /^\$([1-9])([dl])?$/.exec(paint);
  if (m) {
    const roles = sketchRoles(theme);
    // Past the last role it shows as the last one.
    const tok = roles[Math.min(Number(m[1]), roles.length) - 1];
    let hex = color(theme, tok, theme.palette.text);
    if (m[2] === "d") hex = mixColor(hex, "#000000", 0.3);
    if (m[2] === "l") hex = mixColor(hex, "#ffffff", 0.3);
    return { hex, opacity: 1 };
  }
  let h = paint.slice(1);
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  return { hex: "#" + h.slice(0, 6), opacity: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
}

export interface SketchOpts {
  /** The frame's size, so a vertical film gets a 54 × 96 box (default landscape). */
  size?: [number, number];
  /** Hand-drawn: a pencil look (a displaced main pass and a faint ghost outline). */
  rough?: boolean;
  /** Black and white, like a rough draft (for placeholders: "not done yet"). */
  gray?: boolean;
  /** Keeps filter ids unique when several sketches share a page. */
  id?: string;
}

/**
 * The sketch as SVG markup in its own 96 × 54 coordinates (wrap it in an <svg viewBox="0 0 96 54">).
 * Rough: fractal noise at ".045 .06",
 * 2 octaves, displacement 2.1 for the drawing (opacity .92) and 2.7 for a ghost outline (0.5 wide, .3).
 */
export function sketchMarkup(sk: Sketch, theme: Theme, o: SketchOpts = {}): string {
  const { paths } = parseSketch(sk);
  const [BW, BH] = sketchBox(o.size ?? [16, 9]);
  const id = (o.id ?? "sk").replace(/[^\w-]/g, "_");
  const bg = sketchColor(sk.bg ?? "$1", theme).hex;
  const draw = (ghost: boolean) => paths.map((p) => {
    const c = sketchColor(p.paint, theme), op = c.opacity < 1 ? ` opacity="${c.opacity.toFixed(2)}"` : "";
    if (ghost) return `<path d="${p.d}" fill="none" stroke="${c.hex}" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round"${op}/>`;
    return p.line !== undefined
      ? `<path d="${p.d}" fill="none" stroke="${c.hex}" stroke-width="${p.line}" stroke-linecap="round" stroke-linejoin="round"${op}/>`
      : `<path d="${p.d}" fill="${c.hex}"${op}/>`;
  }).join("");
  const gray = o.gray ? `<feColorMatrix type="saturate" values="0"/>` : "";
  if (!o.rough) {
    const defs = gray ? `<defs><filter id="${id}-g">${gray}</filter></defs>` : "";
    return `${defs}<g${gray ? ` filter="url(#${id}-g)"` : ""}><rect width="${BW}" height="${BH}" fill="${bg}"/>${draw(false)}</g>`;
  }
  const filt = (name: string, k: number) =>
    `<filter id="${id}-${name}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".045 .06" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="${k}" xChannelSelector="R" yChannelSelector="G"/>${gray}</filter>`;
  return `<defs>${filt("r", 2.1)}${filt("ghost", 2.7)}${gray ? `<filter id="${id}-g">${gray}</filter>` : ""}</defs>`
    + `<rect width="${BW}" height="${BH}" fill="${bg}"${gray ? ` filter="url(#${id}-g)"` : ""}/>`
    + `<g filter="url(#${id}-r)" opacity=".92">${draw(false)}</g><g filter="url(#${id}-ghost)" opacity=".3">${draw(true)}</g>`;
}
