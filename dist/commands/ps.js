import { listWorktrees } from "../lib/registry.js";
import { loadConfig } from "../lib/config.js";
import { gitRoot } from "../lib/git.js";
import { hasDnsmasqConf, listDnsmasqConfNames } from "../lib/dnsmasq.js";
import { hasCaddyRoutes } from "../lib/caddy.js";
import { listenersOn, processNames } from "../lib/process.js";
import { header, step, info, c } from "../lib/log.js";
export async function ps() {
    const worktrees = listWorktrees();
    if (worktrees.length === 0) {
        info("No worktrees registered");
        return;
    }
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
    header(`wtenv ps  — ${worktrees.length} registered`);
    const registeredCities = new Set(worktrees.map((wt) => wt.city));
    for (const wt of worktrees) {
        const configRoot = gitRoot(wt.project_root) ?? wt.project_root;
        const config = await loadCachedConfig(configRoot);
        const tld = config?.tld ?? "test";
        const [caddyRoutes, dnsmasqConf] = await Promise.all([
            hasCaddyRoutes(wt.city, tld),
            Promise.resolve(hasDnsmasqConf(wt.city)),
        ]);
        console.log();
        step(`${wt.name}  →  ${wt.city}.${tld}`);
        const caddyMark = caddyRoutes ? c.green("✓") : c.red("✗");
        const caddyDetail = caddyRoutes ? "routes loaded" : "no routes";
        console.log(`    ${caddyMark} caddy     ${caddyDetail}`);
        const dnsMark = dnsmasqConf ? c.green("✓") : c.red("✗");
        const dnsDetail = dnsmasqConf ? "config present" : "config missing";
        console.log(`    ${dnsMark} dnsmasq   ${dnsDetail}`);
        const portEntries = Object.entries(wt.ports);
        if (portEntries.length > 0) {
            const portListeners = new Map(portEntries.map(([, port]) => [port, listenersOn(port)]));
            const allPids = [...portListeners.values()].flat();
            const names = processNames([...new Set(allPids)]);
            for (const [service, port] of portEntries) {
                const pids = portListeners.get(port) ?? [];
                if (pids.length > 0) {
                    const pid = pids[0];
                    const name = names.get(pid) ?? "?";
                    console.log(`    ${c.green("✓")} ${service.padEnd(10)} :${port}   PID ${pid} (${name})`);
                }
                else {
                    console.log(`    ${c.dim("○")} ${service.padEnd(10)} :${port}   not running`);
                }
            }
        }
    }
    const orphans = listDnsmasqConfNames().filter((name) => !registeredCities.has(name) && !name.startsWith("project-"));
    if (orphans.length > 0) {
        console.log();
        step("Orphaned configs (not in registry)");
        info(`dnsmasq: ${orphans.join(", ")}`);
    }
    console.log();
}
