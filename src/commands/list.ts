import { listWorktrees } from "../lib/registry.js";
import { loadConfig } from "../lib/config.js";

export function list(): void {
  const worktrees = listWorktrees();

  if (worktrees.length === 0) {
    console.log("No worktrees registered.");
    return;
  }

  const config = loadConfig();

  for (const wt of worktrees) {
    const age = formatAge(wt.created_at);
    console.log(`\n${wt.name}  (${age})`);
    console.log(`  project: ${wt.project_root}`);

    for (const [service, port] of Object.entries(wt.ports)) {
      const serviceCfg = config.services[service];
      if (serviceCfg) {
        const hostname =
          serviceCfg.hostname === "*"
            ? `*.${wt.name}.${config.tld}`
            : `${serviceCfg.hostname}.${wt.name}.${config.tld}`;
        console.log(`  ${service.padEnd(10)} :${port}   http://${hostname}`);
      } else {
        console.log(`  ${service.padEnd(10)} :${port}`);
      }
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
