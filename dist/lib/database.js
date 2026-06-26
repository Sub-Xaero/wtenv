import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { info, warn } from "./log.js";
function sanitizeName(name) {
    return name.replace(/-/g, "_");
}
function databaseName(config, slug) {
    const sanitized = sanitizeName(slug);
    return config.namePattern.replace(/\{slug\}/g, sanitized);
}
function databaseUrl(config, dbName) {
    return `postgres://${config.username}:${config.password}@${config.host}:${config.port}/${dbName}`;
}
function pgEnv(config) {
    return { ...process.env, PGPASSWORD: config.password };
}
function errorText(err) {
    if (err instanceof Error)
        return err.message;
    return String(err);
}
function runProcess(command, args, options) {
    return new Promise((resolve, reject) => {
        let stderr = "";
        const child = spawn(command, args, {
            env: options.env,
            stdio: ["ignore", options.stdout ?? "ignore", "pipe"],
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            const status = code === null ? `signal ${signal ?? "?"}` : `exit ${code}`;
            reject(new Error((stderr.trim() || status).trim()));
        });
    });
}
export async function provisionDatabase(slug, config) {
    const dbName = databaseName(config, slug);
    const env = pgEnv(config);
    try {
        await runProcess("createdb", ["-h", config.host, "-p", String(config.port), "-U", config.username, dbName], {
            env,
        });
    }
    catch (err) {
        const message = errorText(err);
        if (message.includes("already exists")) {
            info(`database '${dbName}' already exists — skipping`);
            return databaseUrl(config, dbName);
        }
        throw new Error(`createdb failed: ${message}`);
    }
    if (config.forkFrom) {
        const dumpFile = join(tmpdir(), `wtenv-${dbName}.dump`);
        let dumpFd = null;
        try {
            info(`forking '${config.forkFrom}' → '${dbName}'`);
            dumpFd = openSync(dumpFile, "w");
            await runProcess("pg_dump", ["-Fc", "-h", config.host, "-p", String(config.port), "-U", config.username, config.forkFrom], { env, stdout: dumpFd });
            closeSync(dumpFd);
            dumpFd = null;
            await runProcess("pg_restore", [
                "-h",
                config.host,
                "-p",
                String(config.port),
                "-U",
                config.username,
                "-d",
                dbName,
                "--no-owner",
                "--no-privileges",
                dumpFile,
            ], { env });
            info(`forked '${config.forkFrom}' → '${dbName}'`);
        }
        finally {
            if (dumpFd !== null)
                closeSync(dumpFd);
            if (existsSync(dumpFile))
                unlinkSync(dumpFile);
        }
    }
    else {
        info(`created database '${dbName}'`);
    }
    return databaseUrl(config, dbName);
}
export async function teardownDatabase(slug, config) {
    const dbName = databaseName(config, slug);
    try {
        await runProcess("dropdb", ["-h", config.host, "-p", String(config.port), "-U", config.username, "--if-exists", dbName], { env: pgEnv(config) });
        info(`dropped database '${dbName}'`);
    }
    catch (err) {
        warn(`dropdb: ${errorText(err)}`);
    }
}
export function buildDatabaseUrl(slug, config) {
    return databaseUrl(config, databaseName(config, slug));
}
