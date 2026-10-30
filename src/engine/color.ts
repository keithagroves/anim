function parse(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** Interpolate two hex colors; non-hex values (e.g. "none") switch at the midpoint. */
export function mixColor(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  return "#" + pa.map((v, i) => hex2(v + (pb[i] - v) * t)).join("");
}

export function luminance(hex: string): number | null {
  const p = parse(hex);
  if (!p) return null;
  const [r, g, b] = p.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number | null {
  const la = luminance(a), lb = luminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
