import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { DOTENV_LAYERS } from "./plugins.js";
// Read the full dotenv stack from disk and merge it. Layering matches the
// generated .envrc (.env < .env.local < .env.worktree) and intentionally does
// not seed from process.env, so callers can decide how to compose it.
export function loadEnvStack(options = {}) {
    const cwd = resolve(options.cwd ?? process.cwd());
    const layers = [...DOTENV_LAYERS, options.envFile ?? ".env.worktree"];
    const merged = {};
    const source = {};
    const present = [];
    for (const file of layers) {
        const p = join(cwd, file);
        if (!existsSync(p))
            continue;
        present.push(file);
        const parsed = parseEnv(readFileSync(p, "utf8"));
        for (const [key, value] of Object.entries(parsed)) {
            merged[key] = value;
            source[key] = file;
        }
    }
    return { cwd, layers, present, merged, source };
}
export function composeEnvStack(options = {}) {
    const stack = loadEnvStack(options);
    return { ...process.env, ...stack.merged };
}
