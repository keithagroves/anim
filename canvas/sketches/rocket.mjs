// A rocket on the pad under the stars… and then it launches.
// Usage: node canvas/sketches/rocket.mjs
import { arc, curve, line, path, poly, rand, reseed, send, status, stroke } from "./lib.mjs";

reseed(42);
const c = [];
const push = (...x) => c.push(...x);
const R = { tag: "rocket" };

push({ op: "clear" }, { op: "camera", x: 0, y: -60, zoom: 0.72, ms: 400 });

// ---- night sky
push(status("stars"));
for (let i = 0; i < 16; i++) {
  const x = rand() * 560, y = -470 + Math.abs(rand()) * 300, s = 7 + Math.abs(rand()) * 8;
  push(stroke(path(line([x - s, y], [x + s, y], 2)), { color: "yellow", size: "s", ms: 60, wobble: 0.4 }));
  push(stroke(path(line([x, y - s], [x, y + s], 2)), { color: "yellow", size: "s", ms: 60, wobble: 0.4 }));
}
push(status("the moon"));
push({ op: "geo", geo: "ellipse", x: 330, y: -470, w: 130, h: 130, color: "yellow", fill: "semi", ms: 500 });
for (const [x, y, r] of [[370, -425, 14], [410, -390, 9], [365, -375, 7]]) push(stroke(arc(x, y, r, r, 0, 360, 16), { color: "orange", size: "s", ms: 150 }));

// ---- ground and launch tower
push(status("the ground"));
push(stroke(path(curve([-620, 210], [-300, 180], [0, 205], 30), curve([0, 205], [300, 230], [620, 200], 30)), { color: "green", size: "l", ms: 900 }));
for (let x = -580; x <= 580; x += 46) push(stroke(line([x, 207 + rand() * 6], [x + 6, 192 + rand() * 4], 2), { color: "green", size: "s", ms: 40 }));

push(status("the launch tower"));
push(stroke(line([-150, 200], [-150, -90], 12), { color: "grey", size: "m", ms: 400 }));
push(stroke(line([-110, 200], [-110, -90], 12), { color: "grey", size: "m", ms: 400 }));
const zig = [];
for (let y = 200, k = 0; y > -90; y -= 36, k++) zig.push([k % 2 ? -110 : -150, y]);
push(stroke(poly(zig, 4), { color: "grey", size: "s", ms: 600 }));
push(stroke(poly([[-150, -90], [-110, -90], [-70, -90]], 3), { color: "grey", size: "m", ms: 200 }));

// ---- the rocket (tagged so it can lift off)
push(status("the rocket"));
push(stroke(path(curve([0, -200], [-60, -150], [-55, -90], 20), line([-55, -90], [-55, 120], 16), line([-55, 120], [55, 120], 8), line([55, 120], [55, -90], 16), curve([55, -90], [60, -150], [0, -200], 20)), { size: "l", ms: 1400, ...R }));
push(stroke(arc(0, -60, 24, 24, -90, 270, 30), { color: "blue", size: "l", ms: 450, ...R }));
push(stroke(arc(-6, -66, 9, 9, 180, 270, 8), { color: "light-blue", size: "s", ms: 120, ...R }));
push(stroke(curve([-55, -150], [0, -165], [55, -150], 14), { color: "red", size: "m", ms: 250, ...R }));
push(stroke(line([-55, 30], [55, 30], 10), { color: "red", size: "m", ms: 250, ...R }));
push(status("fins"));
push(stroke(poly([[-55, 55], [-105, 125], [-105, 150], [-55, 112]], 6), { color: "red", size: "l", ms: 450, ...R }));
push(stroke(poly([[55, 55], [105, 125], [105, 150], [55, 112]], 6), { color: "red", size: "l", ms: 450, ...R }));
push(stroke(poly([[-28, 120], [-36, 145], [36, 145], [28, 120]], 4), { color: "grey", size: "m", ms: 300, ...R }));

// ---- ignition
push({ op: "wait", ms: 500 }, status("3…"), { op: "wait", ms: 700 }, status("2…"), { op: "wait", ms: 700 }, status("1…"), { op: "wait", ms: 600 });
push(status("ignition!"));
push(stroke(path(curve([-30, 148], [-40, 220], [0, 285], 16), curve([0, 285], [40, 220], [30, 148], 16)), { color: "red", size: "l", ms: 350, ...R }));
push(stroke(path(curve([-18, 150], [-24, 200], [0, 245], 12), curve([0, 245], [24, 200], [18, 150], 12)), { color: "orange", size: "l", ms: 250, ...R }));
push(stroke(path(curve([-8, 152], [-10, 180], [0, 205], 8), curve([0, 205], [10, 180], [8, 152], 8)), { color: "yellow", size: "m", ms: 200, ...R }));
push(status("smoke"));
for (const [x, y, r] of [[-70, 190, 34], [-125, 182, 42], [-185, 192, 30], [70, 190, 34], [128, 184, 44], [190, 194, 30]])
  push(stroke(arc(x, y, r, r * 0.8, 0, 360, 22), { color: "grey", size: "m", ms: 140 }));

// ---- liftoff
push(status("liftoff! 🚀"));
push({ op: "move", tag: "rocket", dx: 0, dy: -60, ms: 900, ease: "in" });
push({ op: "move", tag: "rocket", dx: 140, dy: -760, ms: 2600, ease: "in" });
push({ op: "text", x: 150, y: -320, text: "to the moon!", size: "l", color: "violet", ms: 900 });
push({ op: "wait", ms: 300 }, { op: "fit", ms: 900 }, { op: "status", text: "done — your turn: draw something and I'll look at it" });

await send(c);
