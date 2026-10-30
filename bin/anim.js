#!/usr/bin/env node
// Global entry point: runs the TypeScript CLI through tsx, so `anim` works from any directory.
import { register } from "tsx/esm/api";

register();
await import("../src/cli/anim.ts");
