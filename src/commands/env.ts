import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { DOTENV_LAYERS } from "../lib/plugins.js";
import { step, info, warn, c } from "../lib/log.js";

export interface EnvCommandOptions {
  cwd?: string;
  envFile?: string;
}

interface LoadedStack {
  cwd: string;
  layers: string[]; // file names in priority order (lowest → highest)
  present: string[]; // layers that actually exist on disk
  merged: Record<string, string>;
  source: Record<string, string>; // key → the layer its final value came from
}

// Read the full dotenv stack from disk and merge it. Layering matches the
// generated .envrc (.env < .env.local < .env.worktree) and the spawn path in
// plugins.ts, but here we read all three from disk directly — by the time these
// commands run, .env.worktree already exists — and we never seed from
// process.env, so callers see only what the files define.
function loadEnvStack(options: EnvCommandOptions): LoadedStack {
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

// POSIX single-quoting: wrap in single quotes and break out for embedded
// quotes ('\'') so values with spaces, $, or quotes survive `eval` intact.
function shQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// Print `export KEY=VALUE` lines so shells without direnv can load the stack:
//   eval "$(wtenv env export)"
export function envExport(options: EnvCommandOptions = {}): void {
  const stack = loadEnvStack(options);
  if (stack.present.length === 0) {
    // stderr — stdout is consumed by `eval`, so notes must not land there.
    warn(`no env files found in ${stack.cwd} (looked for ${stack.layers.join(", ")})`);
    return;
  }
  const lines = Object.entries(stack.merged).map(
    ([key, value]) => `export ${key}=${shQuote(value)}`,
  );
  if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
}

// Print `unset KEY` lines for every key the stack defines — the inverse of
// `export`, to clear those vars from the current shell:
//   eval "$(wtenv env unset)"
export function envUnset(options: EnvCommandOptions = {}): void {
  const stack = loadEnvStack(options);
  if (stack.present.length === 0) {
    warn(`no env files found in ${stack.cwd} (looked for ${stack.layers.join(", ")})`);
    return;
  }
  const keys = Object.keys(stack.merged);
  if (keys.length > 0) {
    process.stdout.write(keys.map((key) => `unset ${key}`).join("\n") + "\n");
  }
}

// Human-readable view of the merged stack, annotating which layer each value
// won from. Unlike export/unset this is meant to be read, not eval'd.
export function envShow(options: EnvCommandOptions = {}): void {
  const stack = loadEnvStack(options);
  if (stack.present.length === 0) {
    warn(`no env files found in ${stack.cwd} (looked for ${stack.layers.join(", ")})`);
    return;
  }

  const keys = Object.keys(stack.merged).sort();
  step(`env stack  ${c.dim(`(${stack.present.join(" < ")})`)}`);
  const pad = Math.max(...keys.map((k) => k.length));
  for (const key of keys) {
    info(`${key.padEnd(pad)}  ${stack.merged[key]}  ${c.dim(`(${stack.source[key]})`)}`);
  }
}
