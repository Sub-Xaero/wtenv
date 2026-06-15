import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUNDLED_ANIMALS } from "./animals.js";

const DB_DIR = join(homedir(), ".wtenv");
const DB_PATH = join(DB_DIR, "registry.db");

export interface Worktree {
  id: string;            // stable identifier (worktree git-dir absolute path)
  name: string;          // display name (worktree directory basename at register time)
  domain: string;        // checked-out animal name — used as DNS domain identifier
  project_root: string;  // worktree cwd at register time
  created_at: number;
}

export interface PortAssignment {
  worktree_id: string;
  service_name: string;
  port: number;
}

export interface AllocateOptions {
  domainHint?: string;
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
  const hasCity = cols.some((c) => c.name === "city");
  const hasDomain = cols.some((c) => c.name === "domain");

  if (cols.length > 0 && !hasId) {
    // Legacy v1 schema (name-keyed) — unsalvageable, drop and recreate.
    console.warn("wtenv: registry schema upgrade — clearing legacy worktrees. Re-run `wtenv register` in each worktree.");
    db.exec(`
      DROP TABLE IF EXISTS port_assignments;
      DROP TABLE IF EXISTS worktrees;
    `);
  } else if (hasId && hasCity && !hasDomain) {
    // v2 schema used city column — rename to domain in place.
    db.exec("ALTER TABLE worktrees RENAME COLUMN city TO domain");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      domain        TEXT NOT NULL UNIQUE,
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
  `);
}

function pickDomain(db: DatabaseSync, hint?: string): string {
  const takenRows = db.prepare("SELECT domain FROM worktrees").all() as { domain: string }[];
  const taken = new Set(takenRows.map((r) => r.domain));
  if (hint && !taken.has(hint)) return hint;
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
  domain: string;
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

    const domain = pickDomain(db, options.domainHint);

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
      "INSERT INTO worktrees (id, name, domain, project_root, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    const insertPort = db.prepare(
      "INSERT INTO port_assignments (worktree_id, service_name, port) VALUES (?, ?, ?)"
    );
    db.exec("BEGIN");
    try {
      insertWorktree.run(id, name, domain, projectRoot, Date.now());
      for (const [service, port] of Object.entries(assignments)) {
        insertPort.run(id, service, port);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return { domain, ports: assignments };
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

export function getWorktree(id: string): Worktree | null {
  const db = openDb();
  try {
    const row = db.prepare("SELECT * FROM worktrees WHERE id = ?").get(id) as Worktree | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

export function getWorktreeByDomain(domain: string): Worktree | null {
  const db = openDb();
  try {
    const row = db.prepare("SELECT * FROM worktrees WHERE domain = ?").get(domain) as Worktree | undefined;
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
