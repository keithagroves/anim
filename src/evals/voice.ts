import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadVideo } from "../cli/load.js";
import { ROOT, writeJson } from "./util.js";

export interface VoiceMetrics {
  scene: string;
  wer: number;
  diff: { op: string; ref: string; hyp: string }[];
  driftMeanMs: number;
  driftMedianMs: number | null;
  driftP95Ms: number | null;
  driftMaxMs: number | null;
  wpm: number;
  longestPause: number;
  leadSilence: number;
  tailSilence: number;
  lufs: number | null;
  truePeak: number | null;
  checks: { name: string; ok: boolean; detail: string }[];
}

/** Thresholds for a narration to pass. */
export const VOICE_LIMITS = { wer: 0.05, driftMedianMs: 150, wpmMin: 130, wpmMax: 185, longestPause: 1.2, lufsMin: -20, lufsMax: -12, truePeakMax: -1 };

function loudness(wav: string): { lufs: number | null; truePeak: number | null } {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8" });
  const tail = (r.stderr ?? "").split("Summary:").pop() ?? "";
  const I = tail.match(/I:\s+(-?[\d.]+) LUFS/);
  const P = tail.match(/Peak:\s+(-?[\d.]+) dBFS/);
  return { lufs: I ? Number(I[1]) : null, truePeak: P ? Number(P[1]) : null };
}

export function voiceEval(videoArg: string, log = console.log): VoiceMetrics[] {
  const video = resolve(videoArg);
  const v = loadVideo(video);
  const out: VoiceMetrics[] = [];
  for (const s of v.scenes) {
    const sd = join(video, "scenes", s.id);
    if (!existsSync(join(sd, "vo.wav")) || !existsSync(join(sd, "vo.words.json"))) { log(`${s.id}: no narration audio, skipped`); continue; }
    const r = spawnSync("uv", ["run", "--project", join(ROOT, "vo"), "--quiet", "python", join(ROOT, "vo", "asr.py"), sd], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`asr failed for ${s.id}: ${r.stderr.slice(-800)}`);
    const a = JSON.parse(r.stdout.trim().split("\n").pop()!);
    // Loudness is judged on what viewers hear: the rendered mix when it exists (render normalises it).
    const rendered = join(video, "out", "video.mp4");
    const { lufs, truePeak } = loudness(existsSync(rendered) ? rendered : join(sd, "vo.wav"));
    const loudSrc = existsSync(rendered) ? "rendered mix" : "raw narration";
    // With a score, also check the narration is still intelligible over the music.
    let mixWer: number | undefined;
    if (existsSync(join(sd, "mix.wav"))) {
      const rm = spawnSync("uv", ["run", "--project", join(ROOT, "vo"), "--quiet", "python", join(ROOT, "vo", "asr.py"), sd, "--audio", "mix.wav"], { encoding: "utf8" });
      if (rm.status === 0) mixWer = JSON.parse(rm.stdout.trim().split("\n").pop()!).wer;
    }
    const L = VOICE_LIMITS;
    const checks = [
      { name: "wer", ok: a.wer <= L.wer, detail: `${(a.wer * 100).toFixed(1)}% (≤ ${L.wer * 100}%)` },
      { name: "timestamp drift", ok: a.driftMedianMs !== null && a.driftMedianMs <= L.driftMedianMs, detail: `median ${a.driftMedianMs}ms (≤ ${L.driftMedianMs}ms) · p95 ${a.driftP95Ms}ms · vs Whisper, itself ±100–200ms` },
      { name: "pace", ok: a.wpm >= L.wpmMin && a.wpm <= L.wpmMax, detail: `${a.wpm} wpm (${L.wpmMin}–${L.wpmMax})` },
      { name: "longest pause", ok: a.longestPause <= L.longestPause, detail: `${a.longestPause}s (≤ ${L.longestPause}s)` },
      ...(mixWer === undefined ? [] : [{ name: "wer under music", ok: mixWer <= L.wer + 0.02, detail: `${(mixWer * 100).toFixed(1)}% on mix.wav (≤ ${((L.wer + 0.02) * 100).toFixed(0)}%; narration alone ${(a.wer * 100).toFixed(1)}%)` }]),
      { name: "loudness", ok: lufs !== null && lufs >= L.lufsMin && lufs <= L.lufsMax, detail: `${lufs} LUFS on ${loudSrc} (${L.lufsMin} to ${L.lufsMax})` },
      { name: "true peak", ok: truePeak !== null && truePeak <= L.truePeakMax, detail: `${truePeak} dBFS on ${loudSrc} (≤ ${L.truePeakMax})` },
    ];
    const m: VoiceMetrics = { scene: s.id, ...a, lufs, truePeak, checks };
    out.push(m);
    log(`${s.id}`);
    for (const c of checks) log(`  ${c.ok ? "✓" : "✖"} ${c.name.padEnd(20)} ${c.detail}`);
    if (a.diff.length) log(`  differences (script → heard):\n${a.diff.map((d: any) => `    ${d.op}: "${d.ref}" → "${d.hyp}"`).join("\n")}`);
    writeJson(join(video, "build", s.id, "voice-eval.json"), m);
  }
  return out;
}
