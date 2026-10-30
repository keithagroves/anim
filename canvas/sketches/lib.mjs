// Small helpers for writing live sketches as command lists.

let seed = 7;
export const reseed = (s) => (seed = s);
export const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
export const wobble = (pts, amt = 1.4) => pts.map(([x, y]) => [x + rand() * amt, y + rand() * amt]);

export const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
export const poly = (pts, n = 6) => pts.slice(1).flatMap((p, i) => line(pts[i], p, n).slice(i ? 1 : 0));
export const arc = (cx, cy, rx, ry, a0, a1, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
export const curve = (a, c, b, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });
export const path = (...parts) => parts.flat();

export const stroke = (points, o = {}) => ({ op: "stroke", points: wobble(points, o.wobble ?? 1.4), ...o });
export const status = (text) => ({ op: "status", text: `Claude is drawing: ${text}` });

export async function send(cmds, url = "http://localhost:5180/api/cmd") {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cmds) });
  console.log(await res.text(), `${cmds.length} commands`);
}
