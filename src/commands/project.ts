import { loadConfig } from "../lib/config.js";
import { registerProjectDnsmasq, deregisterProjectDnsmasq } from "../lib/dnsmasq.js";
import { registerProjectCaddy, deregisterProjectCaddy } from "../lib/caddy.js";
import { deregisterHostsEntries } from "../lib/hosts.js";
import { bareLocalHostnames, registerMdnsHosts, deregisterMdnsHosts } from "../lib/mdns.js";
import { gitRoot } from "../lib/git.js";

interface ProjectOptions {
  configRoot?: string;
}

export async function projectRegister(opts: ProjectOptions = {}): Promise<void> {
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

  // Bare 2-label .local names bypass /etc/resolver and hit mDNS. Publish them via
  // dns-sd so mDNS returns 127.0.0.1 instantly instead of timing out.
  const bareLocals = bareLocalHostnames(baseDomain, domains.map((d) => d.hostname));
  if (bareLocals.length > 0) {
    registerMdnsHosts(name, bareLocals);
    console.log(`  mDNS: publishing ${bareLocals.join(", ")} via dns-sd`);
  }
  // Clean up any /etc/hosts entries from a previous wtenv version that used that approach.
  deregisterHostsEntries(name);

  await registerProjectCaddy(name, domains);

  console.log("\n  Routes:");
  for (const d of domains) {
    console.log(`  ${d.hostname.padEnd(32)} → :${d.port}`);
  }

  console.log(`\nProject '${name}' registered. https://${baseDomain} is live.`);
}

export async function projectDeregister(opts: ProjectOptions = {}): Promise<void> {
  const configRoot = opts.configRoot ?? gitRoot() ?? process.cwd();
  const config = await loadConfig(configRoot);

  if (!config.project) {
    console.error("No 'project' section found in .wtenv.json");
    process.exit(1);
  }

  const { name, baseDomain, domains } = config.project;

  deregisterProjectDnsmasq(name, baseDomain);
  deregisterMdnsHosts(name);
  deregisterHostsEntries(name);
  await deregisterProjectCaddy(name, domains);

  console.log(`Project '${name}' deregistered.`);
  console.log(`  Removed dnsmasq config for *.${baseDomain}`);
  console.log(`  Removed /etc/resolver/${baseDomain}`);
  console.log(`  Removed Caddy routes`);
}
