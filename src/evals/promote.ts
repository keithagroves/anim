import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { writeJson } from "./util.js";

export interface NewCase { id: string; scene: string; section: string; tags: string[]; source: string; notes?: string }

/** Create a gold case from an already-frozen input folder. */
export function addCaseFromDir(inputDir: string, caseDir: string, meta: NewCase) {
  if (existsSync(join(caseDir, "case.json"))) throw new Error(`case "${meta.id}" already exists`);
  cpSync(inputDir, join(caseDir, "video"), { recursive: true });
  const full = { ...meta, createdAt: new Date().toISOString() };
  writeJson(join(caseDir, "case.json"), full);
  return full;
}
