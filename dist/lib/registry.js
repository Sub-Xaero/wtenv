import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const DB_DIR = join(homedir(), ".wsproxy");
const DB_PATH = join(DB_DIR, "registry.db");
function openDb() {
    if (!existsSync(DB_DIR))
        mkdirSync(DB_DIR, { recursive: true });
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
    CREATE TABLE IF NOT EXISTS worktrees (
      name        TEXT PRIMARY KEY,
      project_root TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS port_assignments (
      worktree_name TEXT NOT NULL,
      service_name  TEXT NOT NULL,
      port          INTEGER NOT NULL UNIQUE,
      PRIMARY KEY (worktree_name, service_name)
    );
  `);
    return db;
}
export function allocatePorts(worktreeName, projectRoot, services, portRange) {
    const db = openDb();
    const existing = db
        .prepare("SELECT name FROM worktrees WHERE name = ?")
        .get(worktreeName);
    if (existing) {
        throw new Error(`Worktree '${worktreeName}' is already registered. Run 'wsproxy deregister ${worktreeName}' first.`);
    }
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
    const insertWorktree = db.prepare("INSERT INTO worktrees (name, project_root, created_at) VALUES (?, ?, ?)");
    const insertPort = db.prepare("INSERT INTO port_assignments (worktree_name, service_name, port) VALUES (?, ?, ?)");
    db.transaction(() => {
        insertWorktree.run(worktreeName, projectRoot, Date.now());
        for (const [service, port] of Object.entries(assignments)) {
            insertPort.run(worktreeName, service, port);
        }
    })();
    db.close();
    return assignments;
}
export function releasePorts(worktreeName) {
    const db = openDb();
    db.transaction(() => {
        db.prepare("DELETE FROM port_assignments WHERE worktree_name = ?").run(worktreeName);
        db.prepare("DELETE FROM worktrees WHERE name = ?").run(worktreeName);
    })();
    db.close();
}
export function getWorktreePorts(worktreeName) {
    const db = openDb();
    const rows = db
        .prepare("SELECT service_name, port FROM port_assignments WHERE worktree_name = ?")
        .all(worktreeName);
    db.close();
    return Object.fromEntries(rows.map((r) => [r.service_name, r.port]));
}
export function listWorktrees() {
    const db = openDb();
    const worktrees = db.prepare("SELECT * FROM worktrees ORDER BY created_at DESC").all();
    const result = worktrees.map((wt) => {
        const ports = db
            .prepare("SELECT service_name, port FROM port_assignments WHERE worktree_name = ?")
            .all(wt.name);
        return { ...wt, ports: Object.fromEntries(ports.map((p) => [p.service_name, p.port])) };
    });
    db.close();
    return result;
}
export function isRegistered(worktreeName) {
    const db = openDb();
    const row = db.prepare("SELECT name FROM worktrees WHERE name = ?").get(worktreeName);
    db.close();
    return row !== undefined;
}
