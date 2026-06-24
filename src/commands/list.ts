import { listWorktrees } from "../lib/registry.js";
import { loadConfig } from "../lib/config.js";
import { gitRoot } from "../lib/git.js";
import type { WtenvConfig } from "../lib/config.js";
import { header, step, info, c } from "../lib/log.js";

interface ListOptions {
  json?: boolean;
}

export async function list(options: ListOptions = {}): Promise<void> {
  const worktrees = listWorktrees();

  if (worktrees.length === 0) {
    if (options.json) {
      console.log(JSON.stringify({ worktrees: [] }, null, 2));
      return;
    }
    info("No worktrees registered");
    return;
  }

  // Cache configs by configRoot so we don't re-load the same .wtenv.config.js
  // once per worktree. Worktrees can span multiple projects.
  const configCache = new Map<string, WtenvConfig | null>();
  const loadCachedConfig = async (configRoot: string): Promise<WtenvConfig | null> => {
    if (!configCache.has(configRoot)) {
      try {
        configCache.set(configRoot, await loadConfig(configRoot));
      } catch {
        configCache.set(configRoot, null);
      }
    }
    return configCache.get(configRoot) ?? null;
  };

  const rows = [];

  for (const wt of worktrees) {
    const configRoot = gitRoot(wt.project_root) ?? wt.project_root;
    const config = await loadCachedConfig(configRoot);
    const tld = config?.tld ?? "test";
    const services = Object.fromEntries(
      Object.entries(wt.ports).map(([service, port]) => {
        const serviceCfg = config?.services[service];
        const hostname = serviceCfg
          ? serviceCfg.hostname === false
            ? null
            : serviceCfg.hostname === "*"
            ? `*.${wt.slug}.${tld}`
            : `${serviceCfg.hostname}.${wt.slug}.${tld}`
          : null;
        return [
          service,
          {
            port,
            hostname,
            url: hostname ? `https://${hostname}` : null,
          },
        ];
      })
    );
    rows.push({
      id: wt.id,
      name: wt.name,
      slug: wt.slug,
      domain: `${wt.slug}.${tld}`,
      projectRoot: wt.project_root,
      createdAt: wt.created_at,
      services,
    });
  }

  if (options.json) {
    console.log(JSON.stringify({ worktrees: rows }, null, 2));
    return;
  }

  header(`Registered worktrees (${worktrees.length})`);

  for (const wt of rows) {
    const age = formatAge(wt.createdAt);
    console.log();
    step(`${wt.name}  →  ${wt.domain}  ${c.dim(`(${age})`)}`);
    info(`${c.dim("project:")} ${wt.projectRoot}`);

    for (const [service, details] of Object.entries(wt.services)) {
      info(`${service.padEnd(10)} :${details.port}${details.hostname ? `   ${details.url}` : ""}`);
    }
  }
  console.log();
}

function formatAge(createdAt: number): string {
  const seconds = Math.floor((Date.now() - createdAt) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
