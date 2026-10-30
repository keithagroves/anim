import { watch } from "node:fs";
import { relative, resolve } from "node:path";
import { loadVideo } from "../cli/load.js";
import { emitTldraw, type CanvasCmd } from "./emit.js";
import type { CScene } from "../engine/types.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

export interface CanvasOpts { scene?: string; speed?: number; instant?: boolean; watch?: boolean; url?: string }

async function post(url: string, cmds: CanvasCmd[]) {
  const res = await fetch(`${url}/api/cmd`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cmds) });
  if (!res.ok) throw new Error(`canvas: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as { delivered: number };
}

function compile(video: string, sceneId?: string): { scene: CScene; audioUrl?: string; warnings: string[] } {
  const v = loadVideo(video);
  const s = sceneId ? v.scenes.find((x) => x.id === sceneId) : v.scenes[0];
  if (!s) throw new Error(`unknown scene ${sceneId}`);
  if (!s.scene || s.errors.length) throw new Error(`scene ${s.id} does not compile:\n  ${s.errors.join("\n  ")}`);
  const warnings = s.issues.map((i) => `${i.level === "error" ? "✖" : "▲"} [${i.rule}] ${i.where}: ${i.message}`);
  return { scene: s.scene, audioUrl: s.audioPath ? `/media?path=${encodeURIComponent(relative(ROOT, s.audioPath))}` : undefined, warnings };
}

/** Draw a scene on the live tldraw canvas: same layout and timing as the video, rendered as editable shapes. */
export async function canvasCmd(videoArg: string, o: CanvasOpts) {
  const video = resolve(videoArg);
  const url = o.url ?? "http://localhost:5180";
  const t0 = performance.now();
  const { scene, audioUrl, warnings } = compile(video, o.scene);
  const { cmds, skipped } = emitTldraw(scene, { speed: o.speed, instant: o.instant, audioUrl });
  const ms = performance.now() - t0;
  for (const w of warnings) console.log(w);
  const r = await post(url, cmds);
  const end = Math.max(...cmds.map((c) => (c.at ?? 0) + (c.ms ?? 0) / 1000));
  console.log(`compiled + emitted ${cmds.length} commands in ${ms.toFixed(0)}ms → ${r.delivered} canvas(es); drawing takes ${end.toFixed(1)}s${skipped.length ? ` (skipped: ${skipped.join(", ")})` : ""}`);

  if (!o.watch) return;

  // Streaming: every time a file in the video changes, recompile and send only the difference.
  let sent = new Map(Object.keys(scene.objects).map((id) => [id, sig(scene, id)]));
  let pending: NodeJS.Timeout | undefined;
  console.log(`watching ${relative(process.cwd(), video)} — save a change to stream it`);
  watch(video, { recursive: true }, (_e, file) => {
    if (!file || /(^|\/)(build|out)\//.test(file)) return;
    clearTimeout(pending);
    pending = setTimeout(async () => {
      try {
        const next = compile(video, o.scene);
        const ids = Object.keys(next.scene.objects);
        const added = ids.filter((id) => !sent.has(id));
        const removed = [...sent.keys()].filter((id) => !next.scene.objects[id]);
        const changed = ids.filter((id) => sent.has(id) && sent.get(id) !== sig(next.scene, id));
        const out: CanvasCmd[] = [];
        for (const id of removed) out.push({ op: "remove", name: id, at: 0, ms: 200 });
        for (const id of changed) {
          const b = next.scene.layout[id], d = next.scene.objects[id].def;
          if (d.type === "arrow" || d.type === "line" || d.type === "group" || sent.get(id)!.split("|")[1] !== sig(next.scene, id).split("|")[1]) {
            out.push({ op: "remove", name: id, at: 0, ms: 0 }); added.push(id); // content changed: redraw
          } else out.push({ op: "update", name: id, at: 0, x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h, ms: 300 });
        }
        if (added.length) {
          const { cmds: add } = emitTldraw(next.scene, { only: new Set(added), instant: false, speed: 4 });
          // Stream new parts in quickly, in timeline order, starting now.
          add.forEach((c, i) => out.push({ ...c, at: 0.05 + i * 0.12, ms: Math.min(c.ms ?? 300, 350) }));
        }
        if (out.length) {
          await post(url, out);
          console.log(`streamed: +${added.length} ~${changed.length} −${removed.length}`);
        }
        for (const w of next.warnings.filter((w) => !warnings.includes(w))) console.log(w);
        sent = new Map(ids.map((id) => [id, sig(next.scene, id)]));
      } catch (e: any) {
        console.log(`(not streamed: ${e.message.split("\n")[0]})`);
      }
    }, 150);
  });
  await new Promise(() => {}); // keep watching
}

/** Signature of an object: geometry | content. Used to diff streamed updates. */
function sig(c: CScene, id: string): string {
  const b = c.layout[id], d = c.objects[id].def;
  return `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}|${d.type}:${d.text ?? ""}:${JSON.stringify(d.from ?? "")}:${JSON.stringify(d.to ?? "")}:${d.stroke ?? ""}:${d.fill ?? ""}`;
}
