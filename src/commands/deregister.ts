import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import type { PluginContext } from "../lib/config.js";
import { executePlan, invertPlan } from "../lib/plan.js";
import { getWorktree, getWorktreePorts, getWorktreeBySlug, listWorktrees } from "../lib/registry.js";
import { worktreeRoot, resolveConfigRoot, worktreeId } from "../lib/git.js";
import { detectCaddyConflict } from "../lib/caddy.js";
import { header, step, info, success, error, warn } from "../lib/log.js";

interface DeregisterOptions {
  cwd?: string;
  configRoot?: string;
  envFile?: string;
  id?: string;     // direct id (bypasses git-dir lookup — used by `wtenv reset`)
  slug?: string;   // look up by slug instead of cwd git-dir
}

function shortName(pluginName: string): string {
  return pluginName.replace(/^wtenv:/, "");
}

export async function deregister(
  name: string | undefined,
  opts: DeregisterOptions = {}
): Promise<void> {
  let cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
  let id = opts.id;

  if (!id && opts.slug) {
    const bySlug = getWorktreeBySlug(opts.slug);
    if (!bySlug) {
      error(`No registered worktree found with slug '${opts.slug}'.`);
      process.exit(1);
    }
    id = bySlug.id;
    cwd = opts.cwd ?? bySlug.project_root;
    name = name ?? bySlug.name;
  }

  if (!id) id = worktreeId(cwd) ?? undefined;
  if (!id) {
    throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
  }

  const configRoot = opts.configRoot ?? resolveConfigRoot(cwd);

  const wt = getWorktree(id);
  if (!wt) {
    error(`No registered worktree found at '${cwd}'.`);
    process.exit(1);
  }
  const worktreeName = name ?? wt.name;

  const config = await loadConfig(configRoot);

  const ctx: PluginContext = {
    worktreeId: id,
    worktreeName,
    slug: wt.slug,
    cwd,
    configRoot,
    ports: getWorktreePorts(id),
    envVars: {},
    config,
  };

  header(`Deregistering '${worktreeName}' (${wt.slug}.${config.tld})`);
  console.log();

  await executePlan(invertPlan(config.plugins), async (plugin) => {
    if (!plugin.onDeregister) return false;
    step(shortName(plugin.name));
    await plugin.onDeregister(ctx);
    console.log();
  });

  const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
  if (existsSync(envFilePath)) {
    unlinkSync(envFilePath);
  }

  success(`Deregistered '${worktreeName}'`);

  const conflict = detectCaddyConflict();
  if (conflict) {
    console.log();
    warn(conflict);
  }
}

export async function deregisterStale(opts: { envFile?: string } = {}): Promise<void> {
  const stale = listWorktrees().filter((wt) => !existsSync(wt.id));

  if (stale.length === 0) {
    info("No stale entries found");
    return;
  }

  header(`Removing ${stale.length} stale ${stale.length === 1 ? "entry" : "entries"}`);
  console.log();

  let failures = 0;
  for (const wt of stale) {
    try {
      await deregister(wt.name, { id: wt.id, cwd: wt.project_root, envFile: opts.envFile });
      console.log();
    } catch (err) {
      failures++;
      warn(`failed to deregister '${wt.name}': ${err instanceof Error ? err.message : err}`);
    }
  }

  if (failures === 0) {
    success(`Cleaned up ${stale.length} stale ${stale.length === 1 ? "entry" : "entries"}`);
  } else {
    warn(`Finished with ${failures} failure${failures === 1 ? "" : "s"}`);
  }
}
