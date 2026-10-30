import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// One-time installs that npm can't do: the Chromium build this Playwright expects, and the voice env.
export function setupCmd() {
  const require = createRequire(import.meta.url);
  const step = (label: string, cmd: string, args: string[]) => {
    console.log(`\n${label}`);
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") console.log(`  skipped: ${cmd} not found`);
    else if (r.status) process.exitCode = r.status;
  };
  step("Chromium for rendering", process.execPath, [join(dirname(require.resolve("playwright/package.json")), "cli.js"), "install", "chromium"]);
  step("Narration env (Kokoro, faster-whisper)", "uv", ["sync", "--project", join(ROOT, "vo")]);
}
