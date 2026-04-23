import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { allocatePorts } from "../lib/registry.js";
import { registerDnsmasq } from "../lib/dnsmasq.js";
import { registerCaddy } from "../lib/caddy.js";
export async function register(worktreeName, opts = {}) {
    const cwd = opts.cwd ?? process.cwd();
    const configRoot = opts.configRoot ?? cwd;
    const config = loadConfig(configRoot);
    const serviceNames = Object.keys(config.services);
    if (opts.dryRun) {
        // Compute what would be allocated without touching the registry
        let nextPort = config.portRange[0];
        console.log("Dry run — would allocate:");
        for (const service of serviceNames) {
            const cfg = config.services[service];
            const hostname = cfg.hostname === "*"
                ? `*.${worktreeName}.${config.tld}`
                : `${cfg.hostname}.${worktreeName}.${config.tld}`;
            console.log(`  ${service}: port ${nextPort}  →  https://${hostname}`);
            nextPort++;
        }
        return;
    }
    // Allocate ports
    const ports = allocatePorts(worktreeName, cwd, serviceNames, config.portRange);
    // Configure dnsmasq
    registerDnsmasq(worktreeName, config.tld);
    // Configure Caddy
    const serviceHostnames = Object.fromEntries(Object.entries(config.services).map(([name, cfg]) => [name, cfg.hostname]));
    await registerCaddy(worktreeName, config.tld, ports, serviceHostnames);
    // Write env file
    const envLines = Object.entries(config.services).map(([service, cfg]) => {
        const port = ports[service];
        return `${cfg.envVar}=${port}`;
    });
    const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
    writeFileSync(envFilePath, envLines.join("\n") + "\n");
    console.log(`Registered worktree '${worktreeName}'`);
    console.log();
    for (const [service, port] of Object.entries(ports)) {
        const cfg = config.services[service];
        const hostname = cfg.hostname === "*"
            ? `*.${worktreeName}.${config.tld}`
            : `${cfg.hostname}.${worktreeName}.${config.tld}`;
        console.log(`  ${service.padEnd(10)} ${cfg.envVar}=${port}   https://${hostname}`);
    }
    console.log();
    console.log(`Env vars written to ${envFilePath}`);
}
