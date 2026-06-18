import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUNDLED_ANIMALS } from "./animals.js";
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
function migrate(db) {
    const cols = db.prepare("PRAGMA table_info(worktrees)").all();
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
    }
    else if (hasId && legacyIdentifier && !hasSlug) {
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
  `);
}
function pickSlug(db, hint) {
    const takenRows = db.prepare("SELECT slug FROM worktrees").all();
    const taken = new Set(takenRows.map((r) => r.slug));
    if (hint && !taken.has(hint))
        return hint;
    const available = BUNDLED_ANIMALS.filter((a) => !taken.has(a));
    if (available.length === 0) {
        throw new Error(`Animal pool exhausted (${BUNDLED_ANIMALS.length} animals, ${taken.size} taken). ` +
            `Deregister an unused worktree or extend src/lib/animals.ts.`);
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
        const slug = pickSlug(db, options.slugHint);
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
        const insertWorktree = db.prepare("INSERT INTO worktrees (id, name, slug, project_root, created_at) VALUES (?, ?, ?, ?, ?)");
        const insertPort = db.prepare("INSERT INTO port_assignments (worktree_id, service_name, port) VALUES (?, ?, ?)");
        db.exec("BEGIN");
        try {
            insertWorktree.run(id, name, slug, projectRoot, Date.now());
            for (const [service, port] of Object.entries(assignments)) {
                insertPort.run(id, service, port);
            }
            db.exec("COMMIT");
        }
        catch (err) {
            db.exec("ROLLBACK");
            throw err;
        }
        return { slug, ports: assignments };
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
export function getWorktreeBySlug(slug) {
    const db = openDb();
    try {
        const row = db.prepare("SELECT * FROM worktrees WHERE slug = ?").get(slug);
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
