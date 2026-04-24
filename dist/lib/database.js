import { spawnSync, execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
function sanitizeName(worktreeName) {
    return worktreeName.replace(/-/g, "_");
}
function databaseName(config, worktreeName) {
    return config.namePattern.replace("{worktree}", sanitizeName(worktreeName));
}
function databaseUrl(config, dbName) {
    return `postgres://${config.username}:${config.password}@${config.host}:${config.port}/${dbName}`;
}
function pgEnv(config) {
    return { ...process.env, PGPASSWORD: config.password };
}
export function provisionDatabase(worktreeName, config) {
    const dbName = databaseName(config, worktreeName);
    const env = pgEnv(config);
    const createResult = spawnSync("createdb", ["-h", config.host, "-p", String(config.port), "-U", config.username, dbName], { stdio: "pipe", env });
    if (createResult.status !== 0) {
        const stderr = createResult.stderr?.toString() ?? "";
        if (stderr.includes("already exists")) {
            console.log(`  Database '${dbName}' already exists — skipping`);
            return databaseUrl(config, dbName);
        }
        throw new Error(`createdb failed: ${stderr.trim()}`);
    }
    if (config.forkFrom) {
        const dumpFile = join(tmpdir(), `wtenv-${dbName}.dump`);
        try {
            process.stdout.write(`  Forking '${config.forkFrom}' → '${dbName}'... `);
            execSync(`pg_dump -Fc -h ${config.host} -p ${config.port} -U ${config.username} ${config.forkFrom} > ${dumpFile}`, { env, stdio: "pipe" });
            execSync(`pg_restore -h ${config.host} -p ${config.port} -U ${config.username} -d ${dbName} --no-owner --no-privileges ${dumpFile}`, { env, stdio: "pipe" });
            console.log("done");
        }
        finally {
            if (existsSync(dumpFile))
                unlinkSync(dumpFile);
        }
    }
    else {
        console.log(`  Created database '${dbName}'`);
    }
    return databaseUrl(config, dbName);
}
export function teardownDatabase(worktreeName, config) {
    const dbName = databaseName(config, worktreeName);
    const result = spawnSync("dropdb", ["-h", config.host, "-p", String(config.port), "-U", config.username, "--if-exists", dbName], { stdio: "pipe", env: pgEnv(config) });
    if (result.status !== 0) {
        const stderr = result.stderr?.toString() ?? "";
        console.warn(`  dropdb warning: ${stderr.trim()}`);
    }
    else {
        console.log(`  Dropped database '${dbName}'`);
    }
}
export function buildDatabaseUrl(worktreeName, config) {
    return databaseUrl(config, databaseName(config, worktreeName));
}
