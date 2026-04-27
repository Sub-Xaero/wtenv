import { loadConfig } from "../lib/config.js";
import { registerProjectDnsmasq, deregisterProjectDnsmasq } from "../lib/dnsmasq.js";
import { registerProjectCaddy, deregisterProjectCaddy } from "../lib/caddy.js";
import { gitRoot } from "../lib/git.js";
export async function projectRegister(opts = {}) {
    const configRoot = opts.configRoot ?? gitRoot() ?? process.cwd();
    const config = await loadConfig(configRoot);
    if (!config.project) {
        console.error("No 'project' section found in .wtenv.json");
        process.exit(1);
    }
    const { name, baseDomain, domains } = config.project;
    console.log(`Registering project '${name}' (${baseDomain})\n`);
    registerProjectDnsmasq(name, baseDomain);
    console.log(`  dnsmasq: address=/.${baseDomain}/127.0.0.1`);
    console.log(`  resolver: /etc/resolver/${baseDomain}`);
    await registerProjectCaddy(name, domains);
    console.log("\n  Routes:");
    for (const d of domains) {
        console.log(`  ${d.hostname.padEnd(32)} → :${d.port}`);
    }
    console.log(`\nProject '${name}' registered. https://${baseDomain} is live.`);
}
export async function projectDeregister(opts = {}) {
    const configRoot = opts.configRoot ?? gitRoot() ?? process.cwd();
    const config = await loadConfig(configRoot);
    if (!config.project) {
        console.error("No 'project' section found in .wtenv.json");
        process.exit(1);
    }
    const { name, baseDomain, domains } = config.project;
    deregisterProjectDnsmasq(name, baseDomain);
    await deregisterProjectCaddy(name, domains);
    console.log(`Project '${name}' deregistered.`);
    console.log(`  Removed dnsmasq config for *.${baseDomain}`);
    console.log(`  Removed /etc/resolver/${baseDomain}`);
    console.log(`  Removed Caddy routes`);
}
