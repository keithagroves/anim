import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { AFTER_OPENER, OPENER, SYSTEM } from "./prompt.ts";

type Msg = { role: "user" | "assistant"; content: string };

/**
 * POST /api/chat { messages, canvas, mode?, afterOpener? }: streams the model's reply back as plain text.
 * mode "opener" asks for just one quick sentence and a title, to say while the full answer (asked for in parallel,
 * with afterOpener) is being worked out.
 * Talks to any OpenAI-compatible chat API (default: Unbiased Pareto). The key stays on the server.
 */
export function chat(env: Record<string, string | undefined>): Plugin {
  const base = (env.LLM_BASE_URL ?? "https://api.unbiased.ai/v1").replace(/\/$/, "");
  const model = env.LLM_MODEL ?? "pareto";
  const key = env.LLM_API_KEY ?? env.UNBIASED_API_KEY ?? env.OPENROUTER_API_KEY;
  return {
    name: "canvas-chat",
    configureServer(server) {
      // Errors must never escape: an unhandled rejection would stop the dev server.
      server.middlewares.use("/api/chat", (req, res) => void handle(req, res).catch((e) => {
        console.error("[chat]", e);
        if (!res.headersSent) res.statusCode = 500;
        res.end(String(e?.message ?? e));
      }));
      const handle = async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
        if (!key) { res.statusCode = 500; return res.end("No API key: set UNBIASED_API_KEY, OPENROUTER_API_KEY or LLM_API_KEY, then restart the canvas server."); }
        let body = "";
        for await (const d of req) body += d;
        let messages: Msg[], canvas: string, mode: string | undefined, afterOpener: boolean | undefined;
        try { ({ messages, canvas, mode, afterOpener } = JSON.parse(body)); if (!messages?.length) throw 0; } catch { res.statusCode = 400; return res.end("expected { messages, canvas }"); }
        const opener = mode === "opener";
        // Only the latest message carries the board state; older turns stay short.
        const history = messages.slice(opener ? -5 : -16).map((m, i, all) =>
          i === all.length - 1 ? { ...m, content: `${m.content}${afterOpener ? `\n\n${AFTER_OPENER}` : ""}\n\n<canvas>\n${canvas || "(empty)"}\n</canvas>` } : m);

        const ctl = new AbortController();
        res.on("close", () => { if (!res.writableEnded) ctl.abort(); }); // the person interrupted
        const t0 = performance.now();
        let first = 0;
        try {
          const up = await fetch(`${base}/chat/completions`, {
            method: "POST",
            signal: ctl.signal,
            headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "HTTP-Referer": "http://localhost:5180", "X-Title": "anim live canvas" },
            body: JSON.stringify({ model, stream: true, max_tokens: opener ? 300 : 2000, temperature: 0.4, messages: [{ role: "system", content: opener ? OPENER : SYSTEM }, ...history] }),
          });
          if (!up.ok || !up.body) { res.statusCode = 502; return res.end(`${model}: HTTP ${up.status} ${await up.text()}`); }
          res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" });
          // Upstream is Server-Sent Events; pass on just the text.
          const reader = up.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let n;
            while ((n = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, n).trim();
              buf = buf.slice(n + 1);
              if (!line.startsWith("data:") || line === "data: [DONE]") continue;
              try {
                const j = JSON.parse(line.slice(5));
                if (j.error) console.error("[chat]", j.error);
                const text = j.choices?.[0]?.delta?.content;
                if (text) { if (!first) first = performance.now(); res.write(text); }
              } catch {}
            }
          }
          res.end();
          console.log(`[chat] ${model}${opener ? " opener" : ""}: first token ${((first - t0) / 1000).toFixed(2)}s, done ${((performance.now() - t0) / 1000).toFixed(2)}s`);
        } catch (e: any) {
          if (ctl.signal.aborted) return;
          if (!res.headersSent) res.statusCode = 502;
          res.end(`chat failed: ${e.message}`);
        }
      };
    },
  };
}
