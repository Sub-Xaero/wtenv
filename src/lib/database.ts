import { spawnSync, execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { info, warn, c } from "./log.js";
import type { DatabaseConfig } from "./config.js";

export type { DatabaseConfig };

function sanitizeName(name: string): string {
  return name.replace(/-/g, "_");
}

function databaseName(config: DatabaseConfig, domain: string): string {
  const sanitized = sanitizeName(domain);
  // {city} and {worktree} kept as legacy aliases so older configs keep working.
  return config.namePattern.replace(/\{(domain|city|worktree)\}/g, sanitized);
}

function databaseUrl(config: DatabaseConfig, dbName: string): string {
  return `postgres://${config.username}:${config.password}@${config.host}:${config.port}/${dbName}`;
}

function pgEnv(config: DatabaseConfig): NodeJS.ProcessEnv {
  return { ...process.env, PGPASSWORD: config.password };
}

export function provisionDatabase(domain: string, config: DatabaseConfig): string {
  const dbName = databaseName(config, domain);
  const env = pgEnv(config);

  const createResult = spawnSync(
    "createdb",
    ["-h", config.host, "-p", String(config.port), "-U", config.username, dbName],
    { stdio: "pipe", env }
  );

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

      execSync(
        `pg_dump -Fc -h ${config.host} -p ${config.port} -U ${config.username} ${config.forkFrom} > ${dumpFile}`,
        { env, stdio: "pipe" }
      );

      execSync(
        `pg_restore -h ${config.host} -p ${config.port} -U ${config.username} -d ${dbName} --no-owner --no-privileges ${dumpFile}`,
        { env, stdio: "pipe" }
      );

      process.stdout.write("done\n");
    } finally {
      if (existsSync(dumpFile)) unlinkSync(dumpFile);
    }
  } else {
    info(`created database '${dbName}'`);
  }

  return databaseUrl(config, dbName);
}

export function teardownDatabase(domain: string, config: DatabaseConfig): void {
  const dbName = databaseName(config, domain);

  const result = spawnSync(
    "dropdb",
    ["-h", config.host, "-p", String(config.port), "-U", config.username, "--if-exists", dbName],
    { stdio: "pipe", env: pgEnv(config) }
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    warn(`dropdb: ${stderr.trim()}`);
  } else {
    info(`dropped database '${dbName}'`);
  }
}

export function buildDatabaseUrl(domain: string, config: DatabaseConfig): string {
  return databaseUrl(config, databaseName(config, domain));
}
