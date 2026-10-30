import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { ROOT } from "./util.js";

export interface ClaudeResult {
  ok: boolean;
  text: string;
  structured?: any;
  costUsd: number;
  durationMs: number;
  turns: number;
  error?: string;
}

export interface ClaudeOpts {
  prompt: string;
  systemPrompt?: string;
  tools?: string[];
  allowedTools?: string[];
  jsonSchema?: object;
  model?: string;
  effort?: string;
  budgetUsd: number;
  cwd?: string;
  timeoutMs?: number;
}

/** Run headless Claude Code (`claude -p`) and parse its JSON result. Spending is capped by --max-budget-usd. */
export function runClaude(o: ClaudeOpts): Promise<ClaudeResult> {
  const args = ["-p", o.prompt, "--output-format", "json", "--no-session-persistence", "--strict-mcp-config", "--max-budget-usd", String(o.budgetUsd)];
  if (o.systemPrompt) args.push("--system-prompt", o.systemPrompt);
  if (o.tools) args.push("--tools", ...(o.tools.length ? o.tools : [""]));
  if (o.allowedTools?.length) args.push("--allowedTools", ...o.allowedTools);
  if (o.jsonSchema) args.push("--json-schema", JSON.stringify(o.jsonSchema));
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  const started = Date.now();
  return new Promise((resolve) => {
    const p = spawn("claude", args, { cwd: o.cwd ?? ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => p.kill("SIGTERM"), o.timeoutMs ?? 20 * 60_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        resolve({
          ok: !j.is_error && j.subtype === "success",
          text: j.result ?? "",
          structured: j.structured_output,
          costUsd: j.total_cost_usd ?? 0,
          durationMs: j.duration_ms ?? Date.now() - started,
          turns: j.num_turns ?? 0,
          error: j.is_error || j.subtype !== "success" ? `${j.subtype}: ${String(j.result ?? "").slice(0, 300)}` : undefined,
        });
      } catch {
        resolve({ ok: false, text: out, costUsd: 0, durationMs: Date.now() - started, turns: 0, error: `claude exited ${code}: ${(err || out).slice(-500)}` });
      }
    });
  });
}

const OLLAMA = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

export interface Decision { choice: string; probs: Record<string, number>; raw: string; durationMs: number }

/**
 * Typed decision from a local model via option-letter log-probabilities (JEV-style): ask a question
 * whose answer is one letter, read the next-token distribution, renormalise over the allowed letters.
 */
export async function ollamaDecide(model: string, prompt: string, options: string[], images: string[] = []): Promise<Decision> {
  const started = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: false, think: false, logprobs: true, top_logprobs: 20,
      options: { temperature: 0, num_predict: 1 },
      messages: [{ role: "user", content: prompt, images: images.map((p) => readFileSync(p).toString("base64")) }],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${model}: HTTP ${res.status} ${await res.text()}`);
  const j: any = await res.json();
  const raw: string = j.message?.content ?? "";
  const top: { token: string; logprob: number }[] = j.logprobs?.[0]?.top_logprobs ?? [];
  const mass: Record<string, number> = Object.fromEntries(options.map((o) => [o, 0]));
  for (const t of top) {
    const k = t.token.trim().toUpperCase();
    if (k in mass) mass[k] += Math.exp(t.logprob);
  }
  const total = Object.values(mass).reduce((a, b) => a + b, 0);
  let probs: Record<string, number>;
  if (total > 0) probs = Object.fromEntries(Object.entries(mass).map(([k, v]) => [k, v / total]));
  else {
    // No logprobs for the allowed letters: fall back to the generated letter with no confidence information.
    const g = raw.trim().toUpperCase()[0];
    probs = Object.fromEntries(options.map((o) => [o, o === g ? 1 : 0]));
  }
  const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
  return { choice, probs, raw, durationMs: Date.now() - started };
}

export async function ollamaHas(model: string): Promise<boolean> {
  try {
    const j: any = await (await fetch(`${OLLAMA}/api/tags`)).json();
    return j.models.some((m: any) => m.name === model || m.name === `${model}:latest`);
  } catch { return false; }
}

export interface NoulQuestion { type: "noul"; instructions: string }

/**
 * Ollama decision models (e.g. clef-flash): POST /v1/systemone with a state, shared images and typed
 * questions; answers come back as probabilities read from the logits (no generated text).
 */
export async function ollamaSystemOne(model: string, state: string, questions: Record<string, NoulQuestion>, images: string[] = []): Promise<{ answers: Record<string, number>; durationMs: number }> {
  const started = Date.now();
  const res = await fetch(`${OLLAMA}/v1/systemone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, state, questions, images: images.map((p) => readFileSync(p).toString("base64")) }),
  });
  if (!res.ok) throw new Error(`ollama ${model} /v1/systemone: HTTP ${res.status} ${await res.text()}`);
  const j: any = await res.json();
  const answers: Record<string, number> = {};
  for (const [k, v] of Object.entries<any>(j.answers ?? {})) answers[k] = v.noul;
  return { answers, durationMs: Date.now() - started };
}
