import { spawnSync } from "node:child_process";
import { loadEnvStack } from "../lib/env-stack.js";
import { warn } from "../lib/log.js";

interface RunOptions {
  cwd?: string;
  envFile?: string;
}

export function run(command: string[], options: RunOptions = {}): void {
  if (command.length === 0) {
    throw new Error("No command provided. Usage: wtenv run <command...>");
  }

  const stack = loadEnvStack(options);
  if (stack.present.length === 0) {
    warn(`no env files found in ${stack.cwd} (looked for ${stack.layers.join(", ")})`);
  }

  const [bin, ...args] = command;
  const result = spawnSync(bin, args, {
    cwd: stack.cwd,
    env: { ...process.env, ...stack.merged },
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  process.exit(1);
}
