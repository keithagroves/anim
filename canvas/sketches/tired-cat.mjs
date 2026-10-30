// "The cat sat because it was tired" — a live doodle of attention.
// Usage: node canvas/sketches/tired-cat.mjs   (with the canvas dev server running on :5180)

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
const wobble = (pts, amt = 1.6) => pts.map(([x, y]) => [x + rand() * amt, y + rand() * amt]);

const line = (a, b, n = 10) => Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
const arc = (cx, cy, rx, ry, a0, a1, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });
const curve = (a, c, b, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });
const path = (...parts) => parts.flat();

const stroke = (points, o = {}) => ({ op: "stroke", points: wobble(points, o.wobble ?? 1.4), ...o });
const status = (text) => ({ op: "status", text: `Claude is drawing: ${text}` });

const cmds = [];
const push = (...c) => cmds.push(...c);

push({ op: "clear" }, { op: "camera", x: -20, y: -90, zoom: 0.85, ms: 400 });

// ---- the mat
push(status("a mat"));
push(stroke(path(line([-270, 125], [280, 125], 20), line([280, 125], [295, 175], 4), line([295, 175], [-285, 175], 20), line([-285, 175], [-270, 125], 4)), { color: "orange", fill: "semi", closed: true, ms: 1100 }));
for (let x = -230; x <= 250; x += 60) push(stroke(line([x, 132], [x + 8, 168], 4), { color: "orange", size: "s", ms: 120 }));

// ---- the cat (a sleepy loaf)
push(status("the cat"));
push(stroke(path(arc(40, 122, 175, 105, 180, 360, 50)), { size: "l", ms: 1200 })); // back
push(stroke(arc(-140, 10, 68, 64, -100, 260, 48), { size: "l", ms: 900 })); // head
push(stroke(path(line([-192, -26], [-190, -96], 6), line([-190, -96], [-150, -48], 6)), { size: "l", ms: 450 })); // left ear
push(stroke(path(line([-128, -50], [-92, -98], 6), line([-92, -98], [-82, -30], 6)), { size: "l", ms: 450 })); // right ear

push(status("sleepy eyes"));
push(stroke(arc(-165, 0, 13, 8, 10, 170, 12), { size: "m", ms: 300 }));
push(stroke(arc(-113, 0, 13, 8, 10, 170, 12), { size: "m", ms: 300 }));
push(stroke(path(line([-147, 18], [-133, 18], 3), line([-133, 18], [-140, 27], 3), line([-140, 27], [-147, 18], 3)), { color: "light-red", fill: "solid", closed: true, size: "s", ms: 250 }));
push(stroke(path(arc(-147, 30, 7, 6, 0, 180, 8), arc(-133, 30, 7, 6, 0, 180, 8)), { size: "s", ms: 300 })); // mouth
push(stroke(line([-178, 22], [-238, 10], 6), { size: "s", ms: 160 }), stroke(line([-178, 30], [-238, 34], 6), { size: "s", ms: 160 }));
push(stroke(line([-102, 22], [-48, 10], 6), { size: "s", ms: 160 }), stroke(line([-102, 30], [-48, 34], 6), { size: "s", ms: 160 }));

push(status("paws, stripes and a tail"));
push(stroke(arc(-75, 122, 22, 16, 180, 360, 14), { size: "m", ms: 250 }), stroke(arc(-30, 122, 22, 16, 180, 360, 14), { size: "m", ms: 250 }));
for (const [x, y] of [[10, 40], [60, 28], [110, 30], [160, 48]]) push(stroke(curve([x, y], [x + 14, y + 22], [x + 6, y + 46], 10), { color: "grey", size: "m", ms: 220 }));
push(stroke(curve([212, 112], [300, 150], [120, 152], 30), { size: "l", ms: 700 }));

push(status("z z z"));
push({ op: "text", x: -70, y: -118, text: "z", size: "s", color: "blue", ms: 200 });
push({ op: "text", x: -40, y: -160, text: "z", size: "m", color: "blue", ms: 200 });
push({ op: "text", x: 0, y: -215, text: "Z", size: "l", color: "blue", ms: 250 });

// ---- the sentence, one word at a time (so attention can point at words)
push(status("the sentence"));
const words = ["The", "cat", "sat", "because", "it", "was", "tired"];
const charW = 21, space = 24, y = -390;
let x = -360;
const centers = {};
for (const w of words) {
  push({ op: "text", x, y, text: w, size: "l", ms: w.length * 70 });
  centers[w] = [x + (w.length * charW) / 2, y + 26];
  x += w.length * charW + space;
}

// ---- attention: "it" looks back at "cat"
push({ op: "wait", ms: 400 }, status("attention: what does “it” refer to?"));
const [itx, ity] = centers.it, [catx, caty] = centers.cat;
push(stroke(arc(itx, ity, 30, 28, -80, 290, 30), { color: "orange", size: "m", ms: 500 }));
push({ op: "arrow", from: [itx - 6, ity - 30], to: [catx + 4, caty - 30], bend: 70, color: "orange", size: "l", ms: 1100 });
push(stroke(arc(catx, caty, 40, 30, -80, 290, 30), { color: "orange", size: "m", ms: 500 }));
push({ op: "text", x: (itx + catx) / 2 - 60, y: y - 120, text: "attention", size: "m", color: "orange", ms: 600 });

// ---- and the word points at the doodle
push(status("…and “cat” means this cat"));
push({ op: "arrow", from: [catx, caty + 34], to: [-150, -110], bend: -30, color: "orange", size: "m", ms: 900 });
push({ op: "wait", ms: 300 }, { op: "fit", ms: 800 }, { op: "status", text: "done — try drawing on it yourself!" });

const res = await fetch("http://localhost:5180/api/cmd", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cmds) });
console.log(await res.text(), `${cmds.length} commands`);
