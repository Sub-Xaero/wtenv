import { spawnSync } from "node:child_process";
import { info, warn } from "./log.js";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 6379;
export function provisionRedis(slug, dbIndex, opts) {
    const host = opts?.host ?? DEFAULT_HOST;
    const port = opts?.port ?? DEFAULT_PORT;
    const ping = spawnSync("redis-cli", ["-h", host, "-p", String(port), "PING"], {
        stdio: "pipe",
    });
    if (ping.status !== 0) {
        const stderr = ping.stderr?.toString().trim();
        throw new Error(`redis is not reachable at ${host}:${port} — ` +
            (stderr || "make sure redis is installed and running (e.g. 'brew services start redis')"));
    }
    info(`allocated redis database ${dbIndex} at ${host}:${port}`);
    return `redis://${host}:${port}/${dbIndex}`;
}
export function teardownRedis(slug, dbIndex, opts) {
    const host = opts?.host ?? DEFAULT_HOST;
    const port = opts?.port ?? DEFAULT_PORT;
    if (opts?.flushOnDeregister ?? true) {
        const result = spawnSync("redis-cli", ["-h", host, "-p", String(port), "-n", String(dbIndex), "FLUSHDB"], { stdio: "pipe" });
        if (result.status !== 0) {
            warn(`FLUSHDB failed: ${result.stderr?.toString().trim() || "unknown error"}`);
        }
        else {
            info(`flushed redis database ${dbIndex}`);
        }
    }
}
