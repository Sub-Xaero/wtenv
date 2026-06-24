import { loadConfig } from "../lib/config.js";
import { getWorktree, getWorktreePorts } from "../lib/registry.js";
import { gitRoot, worktreeId, worktreeRoot } from "../lib/git.js";
import { header, info, c } from "../lib/log.js";
export async function current(options = {}) {
    const cwd = options.cwd ?? worktreeRoot() ?? process.cwd();
    const id = worktreeId(cwd);
    if (!id) {
        throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
    }
    const wt = getWorktree(id);
    if (!wt) {
        throw new Error(`No registered worktree found at '${cwd}'. Run wtenv register first.`);
    }
    const configRoot = options.configRoot ?? gitRoot(cwd) ?? cwd;
    const config = await loadConfig(configRoot);
    const ports = getWorktreePorts(id);
    const domain = `${wt.slug}.${config.tld}`;
    const services = Object.fromEntries(Object.entries(ports).map(([service, port]) => {
        const cfg = config.services[service];
        const hostname = cfg
            ? cfg.hostname === false
                ? null
                : cfg.hostname === "*"
                    ? domain
                    : `${cfg.hostname}.${domain}`
            : null;
        return [service, { port, hostname, url: hostname ? `https://${hostname}` : null }];
    }));
    const payload = {
        id: wt.id,
        name: wt.name,
        slug: wt.slug,
        domain,
        projectRoot: wt.project_root,
        services,
    };
    const format = options.format ?? "readable";
    if (format === "json") {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    const portSummary = Object.entries(ports)
        .map(([service, port]) => `${service}:${port}`)
        .join(" ");
    if (format === "short") {
        console.log(`${domain}${portSummary ? ` ${portSummary}` : ""}`);
        return;
    }
    header(`Current worktree: ${wt.name}`);
    info(`${c.dim("domain:")} ${domain}`);
    info(`${c.dim("project:")} ${wt.project_root}`);
    for (const [service, details] of Object.entries(services)) {
        info(`${service.padEnd(10)} :${details.port}${details.url ? `   ${details.url}` : ""}`);
    }
}
