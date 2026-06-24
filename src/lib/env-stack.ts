import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { DOTENV_LAYERS } from "./plugins.js";

export interface EnvStackOptions {
  cwd?: string;
  envFile?: string;
}

export interface LoadedEnvStack {
  cwd: string;
  layers: string[];
  present: string[];
  merged: Record<string, string>;
  source: Record<string, string>;
}

// Read the full dotenv stack from disk and merge it. Layering matches the
// generated .envrc (.env < .env.local < .env.worktree) and intentionally does
// not seed from process.env, so callers can decide how to compose it.
export function loadEnvStack(options: EnvStackOptions = {}): LoadedEnvStack {
  const cwd = resolve(options.cwd ?? process.cwd());
  const layers = [...DOTENV_LAYERS, options.envFile ?? ".env.worktree"];

  const merged: Record<string, string> = {};
  const source: Record<string, string> = {};
  const present: string[] = [];
  for (const file of layers) {
    const p = join(cwd, file);
    if (!existsSync(p)) continue;
    present.push(file);
    const parsed = parseEnv(readFileSync(p, "utf8")) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      merged[key] = value;
      source[key] = file;
    }
  }

  return { cwd, layers, present, merged, source };
}

export function composeEnvStack(options: EnvStackOptions = {}): NodeJS.ProcessEnv {
  const stack = loadEnvStack(options);
  return { ...process.env, ...stack.merged };
}
