// Minimal ANSI helpers used for register/deregister output. No deps.
// Auto-disables when stdout isn't a TTY or NO_COLOR is set (per https://no-color.org).

import { AsyncLocalStorage } from "node:async_hooks";
import { format } from "node:util";

const ANSI_ON = process.stdout.isTTY === true && !process.env.NO_COLOR;
const RESET = ANSI_ON ? "\x1b[0m" : "";
const wrap = (code: number) => (s: string): string =>
  ANSI_ON ? `\x1b[${code}m${s}${RESET}` : s;

type LogStream = "stdout" | "stderr";

interface LogCapture {
  chunks: string[];
}

export type CapturedResult<T> =
  | { ok: true; result: T; output: string }
  | { ok: false; error: unknown; output: string };

const captureStore = new AsyncLocalStorage<LogCapture>();

function write(text: string, stream: LogStream = "stdout"): void {
  const capture = captureStore.getStore();
  if (capture) {
    capture.chunks.push(text);
    return;
  }
  const output = stream === "stderr" ? process.stderr : process.stdout;
  output.write(text);
}

console.log = (...args: unknown[]): void => write(`${format(...args)}\n`);
console.info = (...args: unknown[]): void => write(`${format(...args)}\n`);
console.warn = (...args: unknown[]): void => write(`${format(...args)}\n`, "stderr");
console.error = (...args: unknown[]): void => write(`${format(...args)}\n`, "stderr");

export const c = {
  bold:   wrap(1),
  dim:    wrap(2),
  red:    wrap(31),
  green:  wrap(32),
  yellow: wrap(33),
  cyan:   wrap(36),
};

export async function captureLogs<T>(fn: () => Promise<T> | T): Promise<CapturedResult<T>> {
  const capture: LogCapture = { chunks: [] };
  try {
    const result = await captureStore.run(capture, fn);
    return { ok: true, result, output: capture.chunks.join("") };
  } catch (error) {
    return { ok: false, error, output: capture.chunks.join("") };
  }
}

export function appendCapturedLog(text: string, stream: LogStream = "stdout"): void {
  write(text, stream);
}

export function flushCapturedLog(output: string): void {
  if (output.length > 0) write(output);
}

// Top-level command header — e.g. "Registering 'muscat-v2'"
export function header(text: string): void {
  write(`${c.bold(c.cyan("▶"))} ${c.bold(text)}\n`);
}

// Plugin step header — e.g. "ports", "dns", "shell"
export function step(text: string): void {
  write(`${c.bold(c.cyan("▸"))} ${c.bold(text)}\n`);
}

// Indented detail line under a step — e.g. "→ slug: tapir"
export function info(text: string): void {
  write(`    ${c.dim("→")} ${text}\n`);
}

// A subprocess command about to run — e.g. "$ bundle install"
export function cmd(text: string): void {
  write(`  ${c.bold("$")} ${c.bold(text)}\n`);
}

// Final success line — e.g. "Registered 'muscat-v2' as lima.local"
export function success(text: string): void {
  write(`${c.bold(c.green("✓"))} ${c.bold(text)}\n`);
}

export function warn(text: string): void {
  write(`${c.bold(c.yellow("⚠"))} ${text}\n`, "stderr");
}

export function error(text: string): void {
  write(`${c.bold(c.red("✗"))} ${text}\n`, "stderr");
}
