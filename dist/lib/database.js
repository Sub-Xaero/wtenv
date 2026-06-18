import { spawnSync, execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { info, warn, c } from "./log.js";
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
export function provisionDatabase(slug, config) {
    const dbName = databaseName(config, slug);
    const env = pgEnv(config);
    const createResult = spawnSync("createdb", ["-h", config.host, "-p", String(config.port), "-U", config.username, dbName], { stdio: "pipe", env });
    if (createResult.status !== 0) {
        const stderr = createResult.stderr?.toString() ?? "";
        if (stderr.includes("already exists")) {
            info(`database '${dbName}' already exists — skipping`);
            return databaseUrl(config, dbName);
        }
        throw new Error(`createdb failed: ${stderr.trim()}`);
    }
    if (config.forkFrom) {
        const dumpFile = join(tmpdir(), `wtenv-${dbName}.dump`);
        try {
            // Mirror the info() prefix exactly so the trailing "done" lands on the same indented line.
            process.stdout.write(`    ${c.dim("→")} forking '${config.forkFrom}' → '${dbName}' ... `);
            execSync(`pg_dump -Fc -h ${config.host} -p ${config.port} -U ${config.username} ${config.forkFrom} > ${dumpFile}`, { env, stdio: "pipe" });
            execSync(`pg_restore -h ${config.host} -p ${config.port} -U ${config.username} -d ${dbName} --no-owner --no-privileges ${dumpFile}`, { env, stdio: "pipe" });
            process.stdout.write("done\n");
        }
        finally {
            if (existsSync(dumpFile))
                unlinkSync(dumpFile);
        }
    }
    else {
        info(`created database '${dbName}'`);
    }
    return databaseUrl(config, dbName);
}
export function teardownDatabase(slug, config) {
    const dbName = databaseName(config, slug);
    const result = spawnSync("dropdb", ["-h", config.host, "-p", String(config.port), "-U", config.username, "--if-exists", dbName], { stdio: "pipe", env: pgEnv(config) });
    if (result.status !== 0) {
        const stderr = result.stderr?.toString() ?? "";
        warn(`dropdb: ${stderr.trim()}`);
    }
    else {
        info(`dropped database '${dbName}'`);
    }
}
export function buildDatabaseUrl(slug, config) {
    return databaseUrl(config, databaseName(config, slug));
}
