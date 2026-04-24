import { loadConfig } from "../lib/config.js";
import { registerProjectDnsmasq, deregisterProjectDnsmasq } from "../lib/dnsmasq.js";
import { registerProjectCaddy, deregisterProjectCaddy } from "../lib/caddy.js";

interface ProjectOptions {
  configRoot?: string;
}

export async function projectRegister(opts: ProjectOptions = {}): Promise<void> {
  const configRoot = opts.configRoot ?? process.cwd();
  const config = loadConfig(configRoot);

  if (!config.project) {
    console.error("No 'project' section found in .wsproxy.json");
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

export async function projectDeregister(opts: ProjectOptions = {}): Promise<void> {
  const configRoot = opts.configRoot ?? process.cwd();
  const config = loadConfig(configRoot);

  if (!config.project) {
    console.error("No 'project' section found in .wsproxy.json");
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
