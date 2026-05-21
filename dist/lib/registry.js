import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUNDLED_CITIES } from "./cities.js";
const DB_DIR = join(homedir(), ".wtenv");
const DB_PATH = join(DB_DIR, "registry.db");
function openDb() {
    if (!existsSync(DB_DIR))
        mkdirSync(DB_DIR, { recursive: true });
    const db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
    return db;
}
// Drop legacy v1 schema (name-keyed, no city column) and recreate. v1 is
// unsalvageable: conductor renames worktree directories so the name primary
// key gets stale, which is the whole reason we're switching to a git-dir id.
function migrate(db) {
    const cols = db.prepare("PRAGMA table_info(worktrees)").all();
    const hasNewSchema = cols.some((c) => c.name === "id") && cols.some((c) => c.name === "city");
    if (cols.length > 0 && !hasNewSchema) {
        console.warn("wtenv: registry schema upgrade — clearing legacy worktrees. Re-run `wtenv register` in each worktree.");
        db.exec(`
      DROP TABLE IF EXISTS port_assignments;
      DROP TABLE IF EXISTS worktrees;
    `);
    }
    db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      city          TEXT NOT NULL UNIQUE,
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
function pickCity(db, hint) {
    const takenRows = db.prepare("SELECT city FROM worktrees").all();
    const taken = new Set(takenRows.map((r) => r.city));
    if (hint && !taken.has(hint))
        return hint;
    const available = BUNDLED_CITIES.filter((c) => !taken.has(c));
    if (available.length === 0) {
        throw new Error(`City pool exhausted (${BUNDLED_CITIES.length} cities, ${taken.size} taken). ` +
            `Deregister an unused worktree or extend src/lib/cities.ts.`);
    }
    return available[Math.floor(Math.random() * available.length)];
}
export function allocateWorktree(id, name, projectRoot, services, portRange, options = {}) {
    const db = openDb();
    try {
        const existing = db
            .prepare("SELECT id FROM worktrees WHERE id = ?")
            .get(id);
        if (existing) {
            throw new Error(`Worktree at '${id}' is already registered. Run 'wtenv deregister' first.`);
        }
        const city = pickCity(db, options.cityHint);
        const usedPorts = new Set(db.prepare("SELECT port FROM port_assignments").all().map((r) => r.port));
        const assignments = {};
        let next = portRange[0];
        for (const service of services) {
            while (usedPorts.has(next))
                next++;
            if (next > portRange[1]) {
                throw new Error(`Port range ${portRange[0]}–${portRange[1]} exhausted.`);
            }
            assignments[service] = next;
            usedPorts.add(next);
            next++;
        }
        const insertWorktree = db.prepare("INSERT INTO worktrees (id, name, city, project_root, created_at) VALUES (?, ?, ?, ?, ?)");
        const insertPort = db.prepare("INSERT INTO port_assignments (worktree_id, service_name, port) VALUES (?, ?, ?)");
        db.exec("BEGIN");
        try {
            insertWorktree.run(id, name, city, projectRoot, Date.now());
            for (const [service, port] of Object.entries(assignments)) {
                insertPort.run(id, service, port);
            }
            db.exec("COMMIT");
        }
        catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
        return { city, ports: assignments };
    }
    finally {
        db.close();
    }
}
export function releaseWorktree(id) {
    const db = openDb();
    try {
        // ON DELETE CASCADE cleans up port_assignments
        db.prepare("DELETE FROM worktrees WHERE id = ?").run(id);
    }
    finally {
        db.close();
    }
}
export function getWorktree(id) {
    const db = openDb();
    try {
        const row = db.prepare("SELECT * FROM worktrees WHERE id = ?").get(id);
        return row ?? null;
    }
    finally {
        db.close();
    }
}
export function getWorktreePorts(id) {
    const db = openDb();
    try {
        const rows = db
            .prepare("SELECT service_name, port FROM port_assignments WHERE worktree_id = ?")
            .all(id);
        return Object.fromEntries(rows.map((r) => [r.service_name, r.port]));
    }
    finally {
        db.close();
    }
}
export function listWorktrees() {
    const db = openDb();
    try {
        // node:sqlite's .all() returns Record<string, SQLOutputValue>[]; cast via
        // unknown because Worktree's named fields don't structurally overlap with
        // the index signature.
        const worktrees = db
            .prepare("SELECT * FROM worktrees ORDER BY created_at DESC")
            .all();
        return worktrees.map((wt) => {
            const ports = db
                .prepare("SELECT service_name, port FROM port_assignments WHERE worktree_id = ?")
                .all(wt.id);
            return { ...wt, ports: Object.fromEntries(ports.map((p) => [p.service_name, p.port])) };
        });
    }
    finally {
        db.close();
    }
}
export function isRegistered(id) {
    const db = openDb();
    try {
        const row = db.prepare("SELECT id FROM worktrees WHERE id = ?").get(id);
        return row !== undefined;
    }
    finally {
        db.close();
    }
}
