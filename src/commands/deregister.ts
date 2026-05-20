import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import type { PluginContext } from "../lib/config.js";
import { getWorktree, getWorktreePorts } from "../lib/registry.js";
import { worktreeRoot, gitRoot, worktreeId } from "../lib/git.js";

interface DeregisterOptions {
  cwd?: string;
  configRoot?: string;
  envFile?: string;
  id?: string; // direct id (bypasses git-dir lookup — used by `wtenv reset`)
}

export async function deregister(
  name: string | undefined,
  opts: DeregisterOptions = {}
): Promise<void> {
  const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
  const configRoot = opts.configRoot ?? gitRoot(cwd) ?? cwd;
  const id = opts.id ?? worktreeId(cwd);
  if (!id) {
    throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
  }

  const wt = getWorktree(id);
  if (!wt) {
    console.error(`No registered worktree found at '${cwd}'.`);
    process.exit(1);
  }
  const worktreeName = name ?? wt.name;

  const config = await loadConfig(configRoot);

  const ctx: PluginContext = {
    worktreeId: id,
    worktreeName,
    city: wt.city,
    cwd,
    configRoot,
    ports: getWorktreePorts(id),
    envVars: {},
    config,
  };

  for (const plugin of [...config.plugins].reverse()) {
    await plugin.onDeregister?.(ctx);
  }

  const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
  if (existsSync(envFilePath)) {
    unlinkSync(envFilePath);
  }

  console.log(`Deregistered worktree '${worktreeName}' (${wt.city}.${config.tld})`);
}
