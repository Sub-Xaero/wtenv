import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { info, warn } from "./log.js";
function redisDir(slug) {
    return join(tmpdir(), `wtenv-redis-${slug}`);
}
function redisLogFile(slug) {
    return join(tmpdir(), `wtenv-redis-${slug}.log`);
}
export function provisionRedis(slug, port, extraArgs = []) {
    const dir = redisDir(slug);
    mkdirSync(dir, { recursive: true });
    const args = [
        "--port", String(port),
        "--daemonize", "yes",
        "--logfile", redisLogFile(slug),
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
export function teardownRedis(slug, port) {
    const result = spawnSync("redis-cli", ["-p", String(port), "shutdown"], { stdio: "pipe" });
    if (result.status !== 0) {
        const stderr = result.stderr?.toString() ?? "";
        warn(`redis-cli shutdown: ${stderr.trim() || "unknown error"}`);
    }
    else {
        info(`stopped redis on port ${port}`);
    }
    try {
        rmSync(redisDir(slug), { recursive: true, force: true });
    }
    catch (err) {
        warn(`could not remove redis data dir: ${String(err)}`);
    }
}
