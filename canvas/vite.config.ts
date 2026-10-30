import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import type { ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { chat } from "./server/chat.ts";

const REPO = resolve(import.meta.dirname, "..");

/**
 * Live command broker: POST /api/cmd with a JSON command (or array) and every open canvas
 * receives it over Server-Sent Events (/api/events) and draws it in real time.
 */
function broker(): Plugin {
  const clients = new Set<ServerResponse>();
  return {
    name: "canvas-broker",
    configureServer(server) {
      server.middlewares.use("/api/events", (req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        const ping = setInterval(() => res.write(": ping\n\n"), 15000);
        req.on("close", () => { clearInterval(ping); clients.delete(res); });
      });
      // /media?path=<repo-relative file>: lets the canvas play a scene's narration.
      server.middlewares.use("/media", (req, res) => {
        const p = new URL(req.url ?? "", "http://x").searchParams.get("path") ?? "";
        const file = resolve(REPO, p);
        if (!file.startsWith(REPO + sep) || !existsSync(file)) { res.statusCode = 404; return res.end(); }
        res.setHeader("content-type", file.endsWith(".wav") ? "audio/wav" : "application/octet-stream");
        res.setHeader("content-length", String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
      server.middlewares.use("/api/cmd", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; return res.end(); }
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          try { JSON.parse(body); } catch { res.statusCode = 400; return res.end("invalid JSON"); }
          for (const c of clients) c.write(`data: ${body.replace(/\n/g, " ")}\n\n`);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ delivered: clients.size }));
        });
      });
    },
  };
}

// canvas/.env (and the shell environment) configure the talking canvas: UNBIASED_API_KEY, LLM_BASE_URL, LLM_MODEL.
export default defineConfig(({ mode }) => ({ plugins: [react(), broker(), chat(loadEnv(mode, import.meta.dirname, ""))] }));
