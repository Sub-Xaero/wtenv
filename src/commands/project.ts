import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { registerProjectDnsmasq, deregisterProjectDnsmasq } from "../lib/dnsmasq.js";
import { registerProjectCaddy, deregisterProjectCaddy } from "../lib/caddy.js";
import { deregisterHostsEntries } from "../lib/hosts.js";
import { bareLocalHostnames, registerMdnsHosts, deregisterMdnsHosts } from "../lib/mdns.js";
import { gitRoot } from "../lib/git.js";
import { detectProjectName } from "./init.js";

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

function buildProjectConfig(name: string): string {
  return `import { defineConfig, defaultPlugins } from "wtenv";
// import { postgres } from "wtenv";

export default defineConfig({
  tld: "test",

  // Static, non-worktree domains served from fixed ports.
  // Register/deregister with: wtenv project register / wtenv project deregister
  project: {
    name: "${name}",
    baseDomain: "${name}.test", // *.${name}.test resolves to 127.0.0.1
    domains: [
      { hostname: "${name}.test",     port: 5000 },
      { hostname: "api.${name}.test", port: 5001 },
    ],
  },

  // services + plugins drive per-worktree \`wtenv register\`.
  // Leave services empty if you only need project-domain registration.
  services: {},

  plugins: [
    ...defaultPlugins(),
    // defaultPlugins() runs: ports → dns → caddy → serviceEnv
    // (in order on register, reverse on deregister).
    //
    // Pipeline examples — uncomment and adapt:
    //
    // {
    //   name: "my-plugin",
    //   onRegister(ctx) {
    //     ctx.envVars.MY_VAR = \`https://\${ctx.worktreeName}.\${ctx.config.tld}\`;
    //   },
    //   onDeregister(ctx) {
    //     // cleanup
    //   },
    // },
    //
    // postgres({
    //   namePattern: "${name}_{worktree}",
    //   host: "localhost",
    //   port: 5432,
    //   username: "postgres",
    //   password: "postgres",
    //   envVar: "DATABASE_URL",
    // }),
  ],
});
`;
}

export function projectInit(options: { force?: boolean; cwd?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const outPath = join(cwd, ".wtenv.config.js");

  if (existsSync(outPath) && !options.force) {
    console.error(`.wtenv.config.js already exists. Use --force to overwrite.`);
    process.exit(1);
  }

  const name = detectProjectName(cwd) ?? "myapp";

  writeFileSync(outPath, buildProjectConfig(name));

  console.log(`Created .wtenv.config.js with project block for "${name}"`);
  console.log("\nNext steps:");
  console.log("  1. Edit .wtenv.config.js — set domains/ports for your services");
  console.log("  2. Run wtenv project register to register the project's static domains");
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
  const bareLocals = bareLocalHostnames(baseDomain, domains.map((d) => d.hostname));
  if (bareLocals.length > 0) {
    console.log(`  Removed mDNS LaunchAgent (wtenv.mdns.${name})`);
  }
  console.log(`  Removed Caddy routes`);
}
