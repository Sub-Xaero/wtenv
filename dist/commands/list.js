import { listWorktrees } from "../lib/registry.js";
import { loadConfig } from "../lib/config.js";
import { gitRoot } from "../lib/git.js";
import { header, step, info, c } from "../lib/log.js";
export async function list() {
    const worktrees = listWorktrees();
    if (worktrees.length === 0) {
        info("No worktrees registered");
        return;
    }
    // Cache configs by configRoot so we don't re-load the same .wtenv.config.js
    // once per worktree. Worktrees can span multiple projects.
    const configCache = new Map();
    const loadCachedConfig = async (configRoot) => {
        if (!configCache.has(configRoot)) {
            try {
                configCache.set(configRoot, await loadConfig(configRoot));
            }
            catch {
                configCache.set(configRoot, null);
            }
        }
        return configCache.get(configRoot) ?? null;
    };
    header(`Registered worktrees (${worktrees.length})`);
    for (const wt of worktrees) {
        const configRoot = gitRoot(wt.project_root) ?? wt.project_root;
        const config = await loadCachedConfig(configRoot);
        const tld = config?.tld ?? "test";
        const age = formatAge(wt.created_at);
        console.log();
        step(`${wt.name}  →  ${wt.slug}.${tld}  ${c.dim(`(${age})`)}`);
        info(`${c.dim("project:")} ${wt.project_root}`);
        for (const [service, port] of Object.entries(wt.ports)) {
            const serviceCfg = config?.services[service];
            if (serviceCfg) {
                const hostname = serviceCfg.hostname === false
                    ? null
                    : serviceCfg.hostname === "*"
                        ? `*.${wt.slug}.${tld}`
                        : `${serviceCfg.hostname}.${wt.slug}.${tld}`;
                info(`${service.padEnd(10)} :${port}${hostname ? `   https://${hostname}` : ""}`);
            }
            else {
                info(`${service.padEnd(10)} :${port}`);
            }
        }
    }
    console.log();
}
function formatAge(createdAt) {
    const seconds = Math.floor((Date.now() - createdAt) / 1000);
    if (seconds < 60)
        return `${seconds}s ago`;
    if (seconds < 3600)
        return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400)
        return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}
