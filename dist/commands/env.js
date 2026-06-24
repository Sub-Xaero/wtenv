import { loadEnvStack } from "../lib/env-stack.js";
import { step, info, warn, c } from "../lib/log.js";
// POSIX single-quoting: wrap in single quotes and break out for embedded
// quotes ('\'') so values with spaces, $, or quotes survive `eval` intact.
function shQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
}
// Print `export KEY=VALUE` lines so shells without direnv can load the stack:
//   eval "$(wtenv env export)"
export function envExport(options = {}) {
    const stack = loadEnvStack(options);
    if (stack.present.length === 0) {
        // stderr — stdout is consumed by `eval`, so notes must not land there.
        warn(`no env files found in ${stack.cwd} (looked for ${stack.layers.join(", ")})`);
        return;
    }
    const lines = Object.entries(stack.merged).map(([key, value]) => `export ${key}=${shQuote(value)}`);
    if (lines.length > 0)
        process.stdout.write(lines.join("\n") + "\n");
}
// Print `unset KEY` lines for every key the stack defines — the inverse of
// `export`, to clear those vars from the current shell:
//   eval "$(wtenv env unset)"
export function envUnset(options = {}) {
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
export function envShow(options = {}) {
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
