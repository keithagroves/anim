// The anim app architecture, drawn live as an editable diagram (boxes are bound to their arrows).
// Usage: node canvas/sketches/architecture.mjs
import { send, status } from "./lib.mjs";

const c = [];
const push = (...x) => c.push(...x);
const W = 230, H = 96;

/** A labelled box. color: violet = Claude, green = local/free, blue = pipeline, orange = evals, red = production. */
const box = (name, x, y, text, color = "blue", o = {}) => ({ op: "geo", geo: o.geo ?? "rectangle", name, x, y, w: o.w ?? W, h: o.h ?? H, text, color, fill: "semi", size: "s", ms: 280, ...o });
const arrow = (from, to, o = {}) => ({ op: "arrow", from, to, size: "s", ms: 450, ...o });
const frame = (label, x, y, w, h, color = "black") => ({ op: "frame", label, x, y, w, h, color, ms: 300 });
const look = (x, y, zoom = 0.8) => ({ op: "camera", x, y, zoom, ms: 700 });

push({ op: "clear" });
push(look(800, 180, 0.62));
push({ op: "text", x: 0, y: -130, text: "anim · app architecture", size: "xl", ms: 900 });
push({ op: "text", x: 800, y: -110, text: "violet = Claude  ·  green = runs locally, free", size: "s", color: "grey", ms: 700 });

// ---- 1. generation pipeline (snakes: across, down, back)
push(status("the generation pipeline"));
push(frame("1 · Generation pipeline", 0, 0, 1560, 470));
push(box("brief", 40, 60, "Brief / topic", "black"));
push(box("director", 360, 60, "Director\nscript · storyboard · style", "violet"));
push(arrow("brief", "director"));
push(box("tts", 680, 60, "Narration →\nKokoro TTS", "green"));
push(arrow("director", "tts"));
push(box("planner", 1000, 60, "Scene planner\nstage + key states", "violet"));
push(arrow("tts", "planner", { text: "cues" }));
push(status("…sections are built in parallel"));
push(box("agents3", 1040, 310, "", "violet", { ms: 150 }), box("agents2", 1020, 295, "", "violet", { ms: 150 }));
push(box("agents", 1000, 280, "Section agents × N\nparallel · isolated", "violet"));
push(arrow("planner", "agents", { text: "contract" }));
push(box("integrate", 680, 280, "Integrate\nlint + seam check", "blue"));
push(arrow("agents", "integrate"));
push(box("render", 360, 280, "Render\nPlaywright + ffmpeg", "blue"));
push(arrow("integrate", "render"));
push(box("mp4", 40, 280, "MP4 + captions", "black", { geo: "ellipse" }));
push(arrow("render", "mp4"));

// ---- 2. engine
push(look(780, 620, 0.7), status("the engine underneath"));
push(frame("2 · Engine (deterministic)", 0, 520, 1560, 210));
push(box("engine", 40, 575, "schemas · layout solver · timing & cues · presets · evaluate(scene, t) · SVG paint · lint & seams · CLI", "black", { w: 1480, h: 110 }));
push(arrow("agents", [1115, 575], { dash: "dashed", text: "anim CLI" }));
push(arrow("render", [475, 575], { dash: "dashed" }));

// ---- front ends
push(look(1760, 360, 0.7), status("front ends"));
push(frame("Front ends", 1610, 0, 300, 730));
push(box("preview", 1645, 60, "Preview player\nscrub · lint · audio", "blue"));
push(box("canvas", 1645, 230, "tldraw canvas\nlive drawing", "green"));
push(box("cli", 1645, 400, "CLI / MCP\nfor agents", "blue"));
push(arrow("preview", [1450, 575], { dash: "dashed" }), arrow("cli", [1520, 630], { dash: "dashed" }));
push(arrow("canvas", "planner", { dash: "dotted", color: "grey", text: "storyboard (next)" }));

// ---- 3. evals (left)
push(look(470, 950, 0.75), status("offline evals"));
push(frame("3 · Evals (offline)", 0, 780, 940, 330, "orange"));
push(box("gold", 670, 990, "Gold cases\nfrozen inputs", "orange"));
push(box("harness", 350, 990, "Harness\ntrials · CIs · baseline", "orange"));
push(arrow("gold", "harness"));
push(box("report", 30, 990, "Report\npass@k · regressions", "orange"));
push(arrow("harness", "report"));
push(box("judges", 30, 840, "Judges\nclef-flash · gemma4 → Claude", "green"));
push(arrow("harness", "judges", { text: "grade" }));
push(box("align", 350, 840, "Alignment\nκ per criterion", "orange"));
push(box("labels", 670, 840, "Blind labels\n(human)", "black"));
push(arrow("judges", "align"), arrow("labels", "align"), arrow("align", "harness", { text: "trusted?" }));

// ---- 4. production loop (right, clockwise)
push(look(1440, 950, 0.75), status("the production feedback loop"));
push(frame("4 · Production loop", 970, 780, 940, 330, "red"));
push(box("traces", 1000, 840, "Traces\nevery generation\n+ export & edits", "red"));
push(box("monitor", 1320, 840, "Monitor\nlive signals + owners", "red"));
push(arrow("traces", "monitor", { text: "record" }));
push(box("analyze", 1640, 840, "Analyze\nfailures + friction", "red"));
push(arrow("monitor", "analyze", { text: "notify" }));
push(box("propose", 1640, 990, "Propose a change", "violet"));
push(arrow("analyze", "propose"));
push(box("decide", 1320, 990, "Decide: accept only\nif the eval run passes", "black"));
push(arrow("propose", "decide"));
push(box("promote", 1000, 990, "Promote\ntrace → gold case", "red"));
push(arrow("decide", "promote"));
push(status("closing the loop"));
push(arrow("promote", "gold", { dash: "dashed", color: "red", text: "new regression test" }));

push({ op: "wait", ms: 300 }, { op: "fit", ms: 1000 }, { op: "status", text: "done — drag any box: arrows stay attached" });
await send(c);
