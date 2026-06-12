import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { info, warn } from "./log.js";

function redisDir(city: string): string {
  return join(tmpdir(), `wtenv-redis-${city}`);
}

function redisLogFile(city: string): string {
  return join(tmpdir(), `wtenv-redis-${city}.log`);
}

export function provisionRedis(city: string, port: number, extraArgs: string[] = []): string {
  const dir = redisDir(city);
  mkdirSync(dir, { recursive: true });

  const args = [
    "--port", String(port),
    "--daemonize", "yes",
    "--logfile", redisLogFile(city),
    "--dir", dir,
    ...extraArgs,
  ];

  const result = spawnSync("redis-server", args, { stdio: "pipe" });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    const stdout = result.stdout?.toString() ?? "";
    const output = stderr || stdout;
    if (output.toLowerCase().includes("already")) {
      info(`redis already running on port ${port} — skipping`);
      return `redis://127.0.0.1:${port}`;
    }
    throw new Error(`redis-server failed: ${output.trim()}`);
  }

  info(`started redis on port ${port}`);
  return `redis://127.0.0.1:${port}`;
}

export function teardownRedis(city: string, port: number): void {
  const result = spawnSync("redis-cli", ["-p", String(port), "shutdown"], { stdio: "pipe" });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    warn(`redis-cli shutdown: ${stderr.trim() || "unknown error"}`);
  } else {
    info(`stopped redis on port ${port}`);
  }

  try {
    rmSync(redisDir(city), { recursive: true, force: true });
  } catch (err) {
    warn(`could not remove redis data dir: ${String(err)}`);
  }
}
