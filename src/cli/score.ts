// anim score: compile each scene's score.json against its timeline, synthesize it, duck it under the
// narration and write scenes/<id>/score.wav (music) + mix.wav (what preview and render play).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ScoreFile, compileScore } from "../score/score.js";
import { duckCurve, levels, mix, readVoice, renderMusic, writeWav } from "../score/render.js";
import { loadVideo } from "./load.js";

const bar = (d: number) => "▁▂▃▄▅▆▇█"[Math.max(0, Math.min(7, Math.round(((d + 60) / 54) * 7)))];

export function scoreCmd(videoDir: string, o: { scene?: string; levels?: boolean }) {
  const v = loadVideo(videoDir);
  let failed = false;
  for (const s of v.scenes) {
    if (o.scene && s.id !== o.scene) continue;
    const p = join(s.dir, "score.json");
    if (!existsSync(p)) { console.log(`${s.id}: no score.json`); continue; }
    if (!s.scene) { console.log(`${s.id}: scene doesn't compile`); failed = true; continue; }
    const parsed = ScoreFile.safeParse(JSON.parse(readFileSync(p, "utf8")));
    if (!parsed.success) {
      for (const i of parsed.error.issues) console.log(`  ✖ score.json: ${i.path.join(".") || "(root)"}: ${i.message}`);
      failed = true; continue;
    }
    const t0 = Date.now();
    const sc = compileScore(parsed.data, s.scene);
    console.log(`${s.id}: ${sc.bpm} BPM, bar 0 at ${sc.t0.toFixed(2)}s, ${sc.events.length} events`);
    if (sc.fit) console.log(`  tempo fit: ${sc.fit.map((f) => `${f.anchor} ${f.offMs >= 0 ? "+" : ""}${f.offMs}ms`).join(" · ")}`);
    const per: Record<string, number> = {};
    for (const e of sc.events) per[e.track] = (per[e.track] ?? 0) + 1;
    console.log(`  tracks: ${Object.entries(per).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
    if (sc.events.length) console.log(`  sounding ${sc.events[0].t.toFixed(2)}s → ${sc.events[sc.events.length - 1].t.toFixed(2)}s of ${sc.duration.toFixed(2)}s`);
    for (const w of sc.warnings) console.log(`  ▲ ${w}`);
    for (const e of sc.errors) console.log(`  ✖ ${e}`);
    if (sc.errors.length) { failed = true; continue; }

    const music = renderMusic(sc, parsed.data.seed ?? 7);
    const duck = duckCurve(s.scene.words, sc.duration, sc.master.duck);
    const voice = s.hasNarration && existsSync(join(s.dir, "vo.wav")) ? readVoice(join(s.dir, "vo.wav"), sc.duration) : undefined;
    writeWav(join(s.dir, "score.wav"), mix(music, new Float32Array(duck.length).fill(1)));
    const out = mix(music, duck, voice);
    writeWav(join(s.dir, "mix.wav"), out);
    console.log(`  wrote score.wav + mix.wav in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Holes are judged on the music before ducking: low under speech is the point of ducking.
    const lm = levels(mix(music, duck)), lx = levels(out), raw = levels(mix(music, new Float32Array(duck.length).fill(1)));
    const quiet = raw.map((d, i) => [i, d] as const).filter(([i, d]) => i >= 1 && i < raw.length - 2 && d < -30);
    if (quiet.length) console.log(`  ▲ music under −30 dBFS (before ducking) at ${quiet.map(([i]) => `${i}s`).join(", ")}: a hole in the bed`);
    if (o.levels) {
      console.log(`  music before ducking, RMS dBFS per second:`);
      console.log(`    ${raw.map(bar).join("")}`);
      console.log(`    ${raw.map((d) => Math.round(d)).join(" ")}`);
      console.log(`  music ducked under the voice:`);
      console.log(`    ${lm.map(bar).join("")}`);
      console.log(`    ${lm.map((d) => Math.round(d)).join(" ")}`);
      console.log(`  mix (music + voice):`);
      console.log(`    ${lx.map(bar).join("")}`);
    }
  }
  if (failed) process.exitCode = 1;
}
