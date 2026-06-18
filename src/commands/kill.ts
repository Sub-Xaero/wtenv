import { loadConfig } from "../lib/config.js";
import { getWorktree, getWorktreePorts } from "../lib/registry.js";
import { gitRoot, worktreeId, worktreeRoot } from "../lib/git.js";
import { header, info, success, warn, error, c } from "../lib/log.js";
import { listenersOn, processNames } from "../lib/process.js";

interface KillOptions {
  cwd?: string;
  configRoot?: string;
  force?: boolean;
  dryRun?: boolean;
}

interface ProjectKillOptions {
  configRoot?: string;
  force?: boolean;
  dryRun?: boolean;
}

interface Listener {
  pid: number;
  port: number;
  label: string; // service name or hostname for display
}

function gather(portsByLabel: Record<string, number>): Listener[] {
  const all: Listener[] = [];
  for (const [label, port] of Object.entries(portsByLabel)) {
    for (const pid of listenersOn(port)) {
      all.push({ pid, port, label });
    }
  }
  return all;
}

function printListeners(listeners: Listener[]): void {
  const names = processNames([...new Set(listeners.map((l) => l.pid))]);
  for (const l of listeners) {
    const name = names.get(l.pid) ?? "?";
    info(`${String(l.pid).padEnd(7)} ${name.padEnd(20)} :${l.port}  (${l.label})`);
  }
}

function killListeners(listeners: Listener[], force: boolean): number {
  const signal = force ? "SIGKILL" : "SIGTERM";
  const uniquePids = [...new Set(listeners.map((l) => l.pid))];
  let killed = 0;
  for (const pid of uniquePids) {
    try {
      process.kill(pid, signal);
      killed++;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ESRCH") continue; // already gone
      warn(`failed to signal pid ${pid}: ${code ?? err}`);
    }
  }
  return killed;
}

export async function kill(opts: KillOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
  const id = worktreeId(cwd);
  if (!id) {
    throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
  }

  const wt = getWorktree(id);
  if (!wt) {
    error(`No registered worktree found at '${cwd}'. Run wtenv register first.`);
    process.exit(1);
  }

  const configRoot = opts.configRoot ?? gitRoot(cwd) ?? cwd;
  const config = await loadConfig(configRoot);
  const ports = getWorktreePorts(id);
  const portSummary = Object.entries(ports)
    .map(([s, p]) => `${s}=${p}`)
    .join("  ");

  const headerText = opts.dryRun
    ? `Dry run: would kill processes on '${wt.name}' (${wt.slug}.${config.tld})`
    : `Killing processes on '${wt.name}' (${wt.slug}.${config.tld})`;
  header(headerText);
  console.log(`    ${c.dim("ports:")} ${portSummary}`);
  console.log();

  const listeners = gather(ports);
  if (listeners.length === 0) {
    success("No processes listening on worktree ports");
    return;
  }

  printListeners(listeners);
  console.log();

  if (opts.dryRun) {
    info(`would send ${opts.force ? "SIGKILL" : "SIGTERM"} to ${new Set(listeners.map((l) => l.pid)).size} process(es) — nothing killed (--dry-run)`);
    return;
  }

  const killed = killListeners(listeners, opts.force ?? false);
  success(`Killed ${killed} process${killed === 1 ? "" : "es"} (${opts.force ? "SIGKILL" : "SIGTERM"})`);
}

export async function projectKill(opts: ProjectKillOptions = {}): Promise<void> {
  const configRoot = opts.configRoot ?? gitRoot() ?? process.cwd();
  const config = await loadConfig(configRoot);

  if (!config.project) {
    error("No 'project' section found in .wtenv.config.js");
    process.exit(1);
  }

  const { name, baseDomain, domains } = config.project;
  // Domain entries can share a port (e.g. multiple hostnames → :3000). Dedupe.
  const portsByLabel: Record<string, number> = {};
  for (const d of domains) {
    const key = `:${d.port}`;
    if (!(key in portsByLabel)) portsByLabel[key] = d.port;
  }

  const headerText = opts.dryRun
    ? `Dry run: would kill processes for project '${name}' (${baseDomain})`
    : `Killing processes for project '${name}' (${baseDomain})`;
  header(headerText);
  const portList = [...new Set(domains.map((d) => d.port))].sort((a, b) => a - b).join(", ");
  console.log(`    ${c.dim("ports:")} ${portList}`);
  console.log();

  const listeners = gather(portsByLabel);
  if (listeners.length === 0) {
    success("No processes listening on project ports");
    return;
  }

  printListeners(listeners);
  console.log();

  if (opts.dryRun) {
    info(`would send ${opts.force ? "SIGKILL" : "SIGTERM"} to ${new Set(listeners.map((l) => l.pid)).size} process(es) — nothing killed (--dry-run)`);
    return;
  }

  const killed = killListeners(listeners, opts.force ?? false);
  success(`Killed ${killed} process${killed === 1 ? "" : "es"} (${opts.force ? "SIGKILL" : "SIGTERM"})`);
}
