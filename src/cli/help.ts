import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKDROP_PRESETS } from "../engine/backdrop.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface CmdHelp {
  usage: string;
  summary: string;
  about?: string;
  options?: [flag: string, what: string][];
  example?: string;
  see?: string;
  video?: boolean; // the first argument is a video folder
}

const SCENE: [string, string] = ["--scene <id>", "the scene (default: the first)"];

export const COMMANDS: Record<string, CmdHelp> = {
  setup: {
    usage: "anim setup",
    summary: "one-time installs: Chromium for rendering, the narration env (uv)",
    about: "Downloads the Chromium build this copy of Playwright expects, then syncs the Python env for Kokoro and faster-whisper if uv is installed. Safe to run again.",
  },
  types: {
    usage: "anim types",
    summary: "the video types: what each is for and how it's made",
    about: "Lists video-types/: what each type is good for, its length and section size, its examples and its guide.",
  },
  new: {
    usage: "anim new <type> <video> [options]",
    summary: "start a video from a type",
    about: "Scaffolds project.json, theme.json, style.md and a first scene from the type, then prints the next steps. <video> is the folder to create.",
    options: [
      ["--title <text>", "the video's title (default: from the folder name)"],
      ["--scene <id>", "the first scene's id (default: 01-main)"],
      ["--vertical", "1080×1920, for a social cut (a second video, never a resize)"],
      ["--backdrop <name>", `the stage look: ${Object.keys(BACKDROP_PRESETS).join(", ")}`],
    ],
    example: `anim new explainer videos/cpu-cache --title "Why the CPU cache exists"`,
    see: "docs/looks.md, docs/theme.md",
  },
  videos: {
    usage: "anim videos [--json]",
    summary: "catalog of ./videos: features, lint, render freshness",
    about: "Lists the videos in ./videos (or the repo's examples when there is none), grouped by type, with length, features, lint status, whether the render is stale, and eval coverage.",
    options: [["--json", "machine-readable output"]],
  },
  voice: {
    usage: "anim voice <video> [--scene id]",
    summary: "narrate each scene → vo.wav + vo.words.json",
    about: "Reads each scene's narration.txt, speaks it with Kokoro (or Chatterbox when project.json sets voice.engine), and writes vo.wav plus word timings that the {cue:name} marks resolve against. Chatterbox runs from CHATTERBOX_PYTHON.",
    options: [SCENE],
    example: "anim voice videos/cpu-cache",
    video: true,
  },
  score: {
    usage: "anim score <video> [--scene id] [--levels]",
    summary: "synthesize score.json → score.wav + mix.wav, ducked under the voice",
    about: "Compiles each scene's score.json against the picture's timeline, synthesizes the music and foley, ducks it under the narration and warns about holes in the bed.",
    options: [SCENE, ["--levels", "print loudness per second: music, ducked music, final mix"]],
    example: "anim score videos/cpu-cache --levels",
    see: "docs/score.md",
    video: true,
  },
  lint: {
    usage: "anim lint <video> [--json]",
    summary: "validate, compile and lint every scene",
    about: "Checks every scene: schema, cues, layout, the seams between sections, motion rules. Exits 1 when there are errors.",
    options: [["--json", "machine-readable output"]],
    example: "anim lint videos/cpu-cache",
    see: "docs/format.md, docs/motion.md",
    video: true,
  },
  preview: {
    usage: "anim preview <video> [--port 5173]",
    summary: "live player that reloads as files change",
    options: [["--port <n>", "port to serve on (default: 5173)"]],
    example: "anim preview videos/cpu-cache",
    video: true,
  },
  render: {
    usage: "anim render <video> [--out file.mp4] [--workers n]",
    summary: "render to <video>/out/video.mp4",
    about: "Renders every scene in headless Chromium, encodes with ffmpeg, mixes in the narration and score, and writes captions (.vtt) next to the video. Lint errors stop the render.",
    options: [
      ["--out <file>", "where to write the video (default: <video>/out/video.mp4)"],
      ["--workers <n>", "browser pages rendering in parallel (default: half the CPU cores, at least 2)"],
    ],
    example: "anim render videos/cpu-cache",
    video: true,
  },
  timing: {
    usage: "anim timing <video> [--scene id]",
    summary: "section spans, cues and the resolved animation schedule",
    about: "Prints when each section starts and ends, what is said in it, and when each animation runs.",
    options: [SCENE],
    video: true,
  },
  plan: {
    usage: "anim plan <video> [--scene id] [--out file.png]",
    summary: "the storyboard: each section's sketch, span, cues and brief",
    options: [SCENE, ["--out <file>", "where to write it (default: <video>/build/<scene>/plan.png, plus an .html)"]],
    see: "docs/format.md",
    video: true,
  },
  sheet: {
    usage: "anim sheet <video> [--scene id] [options]",
    summary: "contact sheet PNG of keyframes, for visual review",
    about: "By default picks the keyframes: each section's start, every settled pose, and just before the end.",
    options: [
      SCENE,
      ["--section <id>", "only this section"],
      ["--times <t,t,…>", "these times, in seconds"],
      ["--every <s>", "a frame every s seconds"],
      ["--backdrops", "the same frame once per backdrop preset, to pick a look (with --times for the moment)"],
      ["--out <file>", "where to write it (default: <video>/build/<scene>/<section|scene>-sheet.png)"],
    ],
    example: "anim sheet videos/cpu-cache --section s2 --every 0.5",
    video: true,
  },
  frame: {
    usage: "anim frame <video> [--scene id] [--t seconds] [--out file.png]",
    summary: "one frame as a PNG",
    options: [
      SCENE,
      ["--t <s>", "the time in seconds (default: 0)"],
      ["--out <file>", "where to write it (default: <video>/build/<scene>/frame-<t>.png)"],
    ],
    example: "anim frame videos/cpu-cache --t 3.2",
    video: true,
  },
  canvas: {
    usage: "anim canvas <video> [--scene id] [options]",
    summary: "draw the scene on the live tldraw canvas",
    about: "Sends the scene to the canvas app (cd canvas && npm run dev) with the same layout and timing as the video.",
    options: [
      SCENE,
      ["--instant", "draw everything at once"],
      ["--speed <x>", "play faster or slower (default: 1; narration only plays at 1)"],
      ["--watch", "redraw whenever a file changes"],
      ["--url <url>", "the canvas app (default: http://localhost:5180)"],
    ],
    video: true,
  },
};

const GROUPS: [string, string[]][] = [
  ["get started", ["setup", "types", "new", "videos"]],
  ["make a video, in this order", ["voice", "score", "lint", "preview", "render"]],
  ["look closer", ["timing", "plan", "sheet", "frame", "canvas"]],
];

export const DEV_HELP: Record<string, string> = {
  eval: `anim eval <command> [options]

Measure how well agents write sections: gold cases, runs, judges, reports (docs/evals.md).

  eval cases                                         list gold cases
  eval add-case <video> --scene id --section id [--tags a,b]
  eval run      [--cases ids|tags] [--trials 1] [--model m] [--effort e] [--judge spec]
                [--concurrency 2] [--budget-usd 5] [--per-run-usd 2.5] [--baseline run] [--id name]
  eval snapshot <video> --id name                    turn a video's current sections into a run
  eval regrade  <run>                                recompute deterministic metrics (free)
  eval judge    <run> [--judge spec] [--budget-usd 1] [--force]
  eval report   <run> [--baseline run]
  eval label    <run> [--port 5174] [--labeler you]  blind labelling UI
  eval align                                         judge vs human agreement per criterion
  eval voice    <video>                              narration WER, timestamp drift, pace, loudness
  eval promote  <trace> [--tags a,b]                 freeze a trace's inputs as a gold case
  eval runs                                          list runs
  eval compare  <runA> <runB> [--judge prefix]       paired A/B: turns, gate, latency, cost, friction, judge

judge specs (free unless marked)
  decision:<model>         Ollama decision model, e.g. clef-flash
  local:<model>            letter-logit chat model, e.g. gemma4:e4b
  cascade:<stage>          flags uncertain criteria
  cascade+claude:<stage>   escalates uncertain criteria to Claude (paid)
  claude[:model]           Claude judges everything (paid)
  <stage> = <model> | decision:<model>`,
  gen: `anim gen <section|scene> <video> --scene id [options]

Agents write sections; every generation is traced (docs/evals.md).

  gen section <video> --scene id --section id [--model m] [--budget-usd 2.5] [--judge spec] [--judge-sample 1]
  gen scene   <video> --scene id [--sections s1,s2] [--concurrency 3] [--budget-usd 2.5 per section] [--judge spec]
              every section not written yet (or the listed ones), in parallel;
              \`anim preview\` shows each one land as it's written`,
  monitor: `anim monitor [command] [options]

Watch live signals and turn failures into proposed changes (docs/evals.md).

  monitor [--notify]                         evaluate live signals (monitor/signals.json)
  monitor analyze [--days 14] [--run id]     group failures by rule, criterion, friction theme
  monitor propose <analysis.md> [--kind change|rule] [--budget-usd 1]
                                             Claude proposes one change, or one new docs/motion.md rule (paid)
  monitor decide <proposal> accept|reject [--run id] [--note text] [--force]`,
};

export function version(): string {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

export function topHelp(): string {
  const docs = relative(process.cwd(), join(ROOT, "docs"));
  const line = (name: string, args: string, what: string) => `  ${`${name} ${args}`.padEnd(22)} ${what}`;
  const out = [
    `anim ${version()}: narrated explainer videos from JSON scene files`,
    "",
    "usage: anim <command> [<video>] [options]",
    "       anim help <command>      options and an example for one command",
  ];
  for (const [title, names] of GROUPS) {
    out.push("", title);
    for (const n of names) {
      const c = COMMANDS[n];
      const args = c.usage.replace(`anim ${n}`, "").replace(/\[.*$/, "").trim();
      out.push(line(n, args, c.summary));
    }
  }
  out.push("", "develop anim (in a clone of the repo)");
  out.push(line("eval", "", "gold cases, runs, judges, reports      anim help eval"));
  out.push(line("gen", "", "agents write sections                  anim help gen"));
  out.push(line("monitor", "", "live signals, proposed changes         anim help monitor"));
  out.push("", `docs: ${docs.startsWith("..") ? join(ROOT, "docs") : docs}/ (format.md, motion.md, looks.md, theme.md, score.md, evals.md)`);
  return out.join("\n");
}

export function commandHelp(name: string): string | undefined {
  if (DEV_HELP[name]) return DEV_HELP[name];
  const c = COMMANDS[name];
  if (!c) return undefined;
  const out = [c.usage, "", c.about ?? capitalize(c.summary) + "."];
  if (c.options?.length) {
    const w = Math.max(...c.options.map(([f]) => f.length)) + 3;
    out.push("", "options", ...c.options.map(([f, what]) => `  ${f.padEnd(w)}${what}`));
  }
  if (c.example) out.push("", "example", `  ${c.example}`);
  if (c.see) out.push("", `see ${c.see}`);
  return out.join("\n");
}

export function isCommand(name: string): boolean {
  return name in COMMANDS || name in DEV_HELP;
}

/** The closest command name, if it is a plausible typo. */
export function suggest(name: string, names = [...Object.keys(COMMANDS), ...Object.keys(DEV_HELP)]): string | undefined {
  let best: string | undefined, bestD = Infinity;
  for (const n of names) {
    const d = distance(name, n);
    if (d < bestD) { best = n; bestD = d; }
  }
  return bestD <= Math.max(1, Math.floor(name.length / 3)) || best?.startsWith(name) ? best : undefined;
}

export function unknownCommand(kind: string, name: string, names?: string[]): never {
  const s = suggest(name, names);
  const where = kind === "anim" ? "anim help" : `anim help ${kind}`;
  console.error(`anim: unknown ${kind === "anim" ? "" : kind + " "}command "${name}".${s ? ` Did you mean "${s}"?` : ""} Run ${where} for the list.`);
  process.exit(1);
}

export function missingArg(name: string, what: string): never {
  console.error(`anim ${name}: missing ${what}\n`);
  console.error(commandHelp(name));
  process.exit(1);
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
