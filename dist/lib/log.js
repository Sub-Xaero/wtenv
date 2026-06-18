// Minimal ANSI helpers used for register/deregister output. No deps.
// Auto-disables when stdout isn't a TTY or NO_COLOR is set (per https://no-color.org).
const ANSI_ON = process.stdout.isTTY === true && !process.env.NO_COLOR;
const RESET = ANSI_ON ? "\x1b[0m" : "";
const wrap = (code) => (s) => ANSI_ON ? `\x1b[${code}m${s}${RESET}` : s;
export const c = {
    bold: wrap(1),
    dim: wrap(2),
    red: wrap(31),
    green: wrap(32),
    yellow: wrap(33),
    cyan: wrap(36),
};
// Top-level command header — e.g. "Registering 'muscat-v2'"
export function header(text) {
    console.log(`${c.bold(c.cyan("▶"))} ${c.bold(text)}`);
}
// Plugin step header — e.g. "ports", "dns", "shell"
export function step(text) {
    console.log(`${c.bold(c.cyan("▸"))} ${c.bold(text)}`);
}
// Indented detail line under a step — e.g. "→ slug: tapir"
export function info(text) {
    console.log(`    ${c.dim("→")} ${text}`);
}
// A subprocess command about to run — e.g. "$ bundle install"
export function cmd(text) {
    console.log(`  ${c.bold("$")} ${c.bold(text)}`);
}
// Final success line — e.g. "Registered 'muscat-v2' as lima.local"
export function success(text) {
    console.log(`${c.bold(c.green("✓"))} ${c.bold(text)}`);
}
export function warn(text) {
    console.warn(`${c.bold(c.yellow("⚠"))} ${text}`);
}
export function error(text) {
    console.error(`${c.bold(c.red("✗"))} ${text}`);
}
