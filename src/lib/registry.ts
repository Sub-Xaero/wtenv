import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUNDLED_ANIMALS } from "./animals.js";
import type { ProjectDomain } from "./config.js";

const DB_DIR = join(homedir(), ".wtenv");
const DB_PATH = join(DB_DIR, "registry.db");

export interface Worktree {
  id: string;            // stable identifier (worktree git-dir absolute path)
  name: string;          // display name (worktree directory basename at register time)
  slug: string;          // checked-out animal name — the DNS label, forms slug.tld
  project_root: string;  // worktree cwd at register time
  created_at: number;
}

export interface PortAssignment {
  worktree_id: string;
  service_name: string;
  port: number;
}

export interface ProjectRegistration {
  name: string;
  config_root: string;
  base_domain: string;
  created_at: number;
  updated_at: number;
}

export interface AllocateOptions {
  slugHint?: string;
}

export function validateSlug(slug: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug)) {
    throw new Error(
      `Invalid slug '${slug}'. Use a DNS-safe label: lowercase letters, numbers, and hyphens.`
    );
  }
}

function openDb(): DatabaseSync {
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(worktrees)").all() as { name: string }[];
  const hasId = cols.some((c) => c.name === "id");
  const hasSlug = cols.some((c) => c.name === "slug");
  // Earlier schemas named this column "city" then "domain"; both held the same
  // bare animal identifier now called "slug".
  const legacyIdentifier = cols.find((c) => c.name === "city" || c.name === "domain");

  if (cols.length > 0 && !hasId) {
    // Legacy v1 schema (name-keyed) — unsalvageable, drop and recreate.
    console.warn("wtenv: registry schema upgrade — clearing legacy worktrees. Re-run `wtenv register` in each worktree.");
    db.exec(`
      DROP TABLE IF EXISTS port_assignments;
      DROP TABLE IF EXISTS worktrees;
    `);
  } else if (hasId && legacyIdentifier && !hasSlug) {
    // Rename the legacy identifier column (city/domain) to slug in place.
    db.exec(`ALTER TABLE worktrees RENAME COLUMN ${legacyIdentifier.name} TO slug`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      slug          TEXT NOT NULL UNIQUE,
      project_root  TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS port_assignments (
      worktree_id   TEXT NOT NULL,
      service_name  TEXT NOT NULL,
      port          INTEGER NOT NULL UNIQUE,
      PRIMARY KEY (worktree_id, service_name),
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS redis_databases (
      worktree_id   TEXT NOT NULL UNIQUE,
      db_index      INTEGER NOT NULL UNIQUE,
      PRIMARY KEY (worktree_id),
      FOREIGN KEY (worktree_id) REFERENCES worktrees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS projects (
      name          TEXT PRIMARY KEY,
      config_root   TEXT NOT NULL,
      base_domain   TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_domains (
      project_name  TEXT NOT NULL,
      hostname      TEXT NOT NULL,
      port          INTEGER NOT NULL,
      PRIMARY KEY (project_name, hostname),
      FOREIGN KEY (project_name) REFERENCES projects(name) ON DELETE CASCADE
    );
  `);
}

function pickSlug(db: DatabaseSync, hint?: string): string {
  const takenRows = db.prepare("SELECT slug FROM worktrees").all() as { slug: string }[];
  const taken = new Set(takenRows.map((r) => r.slug));
  if (hint) {
    validateSlug(hint);
    if (taken.has(hint)) {
      throw new Error(`Slug '${hint}' is already in use.`);
    }
    return hint;
  }
  const available = BUNDLED_ANIMALS.filter((a) => !taken.has(a));
  if (available.length === 0) {
    throw new Error(
      `Animal pool exhausted (${BUNDLED_ANIMALS.length} animals, ${taken.size} taken). ` +
        `Deregister an unused worktree or extend src/lib/animals.ts.`
    );
  }
  return available[Math.floor(Math.random() * available.length)];
}

export interface AllocationResult {
  slug: string;
  ports: Record<string, number>;
}

export function allocateWorktree(
  id: string,
  name: string,
  projectRoot: string,
  services: string[],
  portRange: [number, number],
  options: AllocateOptions = {}
): AllocationResult {
  const db = openDb();
  try {
    const existing = db
      .prepare("SELECT id FROM worktrees WHERE id = ?")
      .get(id);
    if (existing) {
      throw new Error(`Worktree at '${id}' is already registered. Run 'wtenv deregister' first.`);
    }

    const slug = pickSlug(db, options.slugHint);

    const usedPorts = new Set<number>(
      (db.prepare("SELECT port FROM port_assignments").all() as { port: number }[]).map(
        (r) => r.port
      )
    );

    const assignments: Record<string, number> = {};
    let next = portRange[0];
    for (const service of services) {
      while (usedPorts.has(next)) next++;
      if (next > portRange[1]) {
        throw new Error(`Port range ${portRange[0]}–${portRange[1]} exhausted.`);
      }
      assignments[service] = next;
      usedPorts.add(next);
      next++;
    }

    const insertWorktree = db.prepare(
      "INSERT INTO worktrees (id, name, slug, project_root, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insertPort = db.prepare(
      "INSERT INTO port_assignments (worktree_id, service_name, port) VALUES (?, ?, ?)"
    );
    db.exec("BEGIN");
    try {
      insertWorktree.run(id, name, slug, projectRoot, Date.now());
      for (const [service, port] of Object.entries(assignments)) {
        insertPort.run(id, service, port);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return { slug, ports: assignments };
  } finally {
    db.close();
  }
}

export function releaseWorktree(id: string): void {
  const db = openDb();
  try {
    // ON DELETE CASCADE cleans up port_assignments
    db.prepare("DELETE FROM worktrees WHERE id = ?").run(id);
  } finally {
    db.close();
  }
}

export function registerProjectRegistration(
  name: string,
  configRoot: string,
  baseDomain: string,
  domains: ProjectDomain[]
): void {
  const db = openDb();
  try {
    const now = Date.now();
    const existing = db.prepare("SELECT created_at FROM projects WHERE name = ?").get(name) as
      | { created_at: number }
      | undefined;
    const createdAt = existing?.created_at ?? now;

    db.exec("BEGIN");
    try {
      db.prepare(
        `INSERT OR REPLACE INTO projects
          (name, config_root, base_domain, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(name, configRoot, baseDomain, createdAt, now);
      db.prepare("DELETE FROM project_domains WHERE project_name = ?").run(name);

      const insertDomain = db.prepare(
        "INSERT INTO project_domains (project_name, hostname, port) VALUES (?, ?, ?)"
      );
      for (const domain of domains) {
        insertDomain.run(name, domain.hostname, domain.port);
      }

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.close();
  }
}

export function releaseProjectRegistration(name: string): void {
  const db = openDb();
  try {
    db.prepare("DELETE FROM projects WHERE name = ?").run(name);
  } finally {
    db.close();
  }
}

export function listProjects(): Array<ProjectRegistration & { domains: ProjectDomain[] }> {
  const db = openDb();
  try {
    const projects = db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC")
      .all() as unknown as ProjectRegistration[];
    return projects.map((project) => {
      const domains = db
        .prepare("SELECT hostname, port FROM project_domains WHERE project_name = ? ORDER BY hostname")
        .all(project.name) as unknown as ProjectDomain[];
      return {
        ...project,
        domains: domains.map((domain) => ({ hostname: domain.hostname, port: domain.port })),
      };
    });
  } finally {
    db.close();
  }
}

export function renameWorktreeSlug(id: string, slug: string): void {
  validateSlug(slug);
  const db = openDb();
  try {
    const existing = db.prepare("SELECT id FROM worktrees WHERE slug = ?").get(slug) as
      | { id: string }
      | undefined;
    if (existing && existing.id !== id) {
      throw new Error(`Slug '${slug}' is already in use.`);
    }
    const result = db.prepare("UPDATE worktrees SET slug = ? WHERE id = ?").run(slug, id);
    if (result.changes === 0) {
      throw new Error(`No registered worktree found for '${id}'.`);
    }
  } finally {
    db.close();
  }
}

export function getWorktree(id: string): Worktree | null {
  const db = openDb();
  try {
    const row = db.prepare("SELECT * FROM worktrees WHERE id = ?").get(id) as Worktree | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

export function getWorktreeBySlug(slug: string): Worktree | null {
  const db = openDb();
  try {
    const row = db.prepare("SELECT * FROM worktrees WHERE slug = ?").get(slug) as Worktree | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

export function getWorktreePorts(id: string): Record<string, number> {
  const db = openDb();
  try {
    const rows = db
      .prepare("SELECT service_name, port FROM port_assignments WHERE worktree_id = ?")
      .all(id) as { service_name: string; port: number }[];
    return Object.fromEntries(rows.map((r) => [r.service_name, r.port]));
  } finally {
    db.close();
  }
}

export function listWorktrees(): Array<Worktree & { ports: Record<string, number> }> {
  const db = openDb();
  try {
    // node:sqlite's .all() returns Record<string, SQLOutputValue>[]; cast via
    // unknown because Worktree's named fields don't structurally overlap with
    // the index signature.
    const worktrees = db
      .prepare("SELECT * FROM worktrees ORDER BY created_at DESC")
      .all() as unknown as Worktree[];
    return worktrees.map((wt) => {
      const ports = db
        .prepare("SELECT service_name, port FROM port_assignments WHERE worktree_id = ?")
        .all(wt.id) as { service_name: string; port: number }[];
      return { ...wt, ports: Object.fromEntries(ports.map((p) => [p.service_name, p.port])) };
    });
  } finally {
    db.close();
  }
}

export function isRegistered(id: string): boolean {
  const db = openDb();
  try {
    const row = db.prepare("SELECT id FROM worktrees WHERE id = ?").get(id);
    return row !== undefined;
  } finally {
    db.close();
  }
}

export function allocateRedisDb(
  worktreeId: string,
  opts?: { dbStart?: number; dbEnd?: number }
): number {
  const dbStart = opts?.dbStart ?? 0;
  const dbEnd = opts?.dbEnd ?? 1023;

  const db = openDb();
  try {
    const taken = db
      .prepare("SELECT db_index FROM redis_databases")
      .all() as { db_index: number }[];
    const used = new Set(taken.map((r) => r.db_index));

    let dbIndex = dbStart;
    while (used.has(dbIndex)) {
      dbIndex++;
      if (dbIndex > dbEnd) {
        throw new Error(
          `Redis database index pool exhausted (${dbStart}–${dbEnd})`
        );
      }
    }

    db.prepare("INSERT INTO redis_databases (worktree_id, db_index) VALUES (?, ?)").run(
      worktreeId,
      dbIndex
    );

    return dbIndex;
  } finally {
    db.close();
  }
}

export function getRedisDb(worktreeId: string): number | null {
  const db = openDb();
  try {
    const row = db
      .prepare("SELECT db_index FROM redis_databases WHERE worktree_id = ?")
      .get(worktreeId) as { db_index: number } | undefined;
    return row?.db_index ?? null;
  } finally {
    db.close();
  }
}

export function releaseRedisDb(worktreeId: string): void {
  const db = openDb();
  try {
    db.prepare("DELETE FROM redis_databases WHERE worktree_id = ?").run(worktreeId);
  } finally {
    db.close();
  }
}
