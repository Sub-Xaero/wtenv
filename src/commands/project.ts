import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../lib/config.js";
import { registerProjectDnsmasq, deregisterProjectDnsmasq } from "../lib/dnsmasq.js";
import { registerProjectCaddy, deregisterProjectCaddy } from "../lib/caddy.js";
import { deregisterHostsEntries } from "../lib/hosts.js";
import { bareLocalHostnames, registerMdnsHosts, deregisterMdnsHosts } from "../lib/mdns.js";
import { registerProjectRegistration, releaseProjectRegistration } from "../lib/registry.js";
import { resolveConfigRoot } from "../lib/git.js";
import { detectProjectName } from "./init.js";
import { header, step, info, success, error, c } from "../lib/log.js";

interface ProjectOptions {
  configRoot?: string;
}

export async function projectRegister(opts: ProjectOptions = {}): Promise<void> {
  const configRoot = opts.configRoot ? resolve(opts.configRoot) : resolveConfigRoot();
  const config = await loadConfig(configRoot);

  if (!config.project) {
    error("No 'project' section found in .wtenv.config.js");
    process.exit(1);
  }

  const { name, baseDomain, domains } = config.project;

  header(`Registering project '${name}' (${baseDomain})`);
  console.log(`    ${c.dim("config:")} ${configRoot}`);
  console.log();

  step("dns");
  registerProjectDnsmasq(name, baseDomain);
  info(`wrote dnsmasq.d/project-${name}.conf`);
  info(`address=/.${baseDomain}/ → 127.0.0.1`);
  // registerProjectDnsmasq handles the resolver file itself (incl. .local TLD coverage)
  // and prints any skip/warn lines via the log helpers — nothing to log here on success.

  // Bare 2-label .local names bypass /etc/resolver and hit mDNS. Publish them via
  // dns-sd so mDNS returns 127.0.0.1 instantly instead of timing out.
  const bareLocals = bareLocalHostnames(baseDomain, domains.map((d) => d.hostname));
  if (bareLocals.length > 0) {
    registerMdnsHosts(name, bareLocals);
    info(`mDNS: publishing ${bareLocals.join(", ")} via dns-sd`);
  }
  // Clean up any /etc/hosts entries from a previous wtenv version that used that approach.
  deregisterHostsEntries(name);
  console.log();

  step("caddy");
  await registerProjectCaddy(name, domains);
  info(`added ${domains.length} route${domains.length === 1 ? "" : "s"}`);
  const padTo = Math.max(...domains.map((d) => d.hostname.length));
  for (const d of domains) {
    console.log(`        ${d.hostname.padEnd(padTo)}  → :${d.port}`);
  }
  console.log();

  step("registry");
  registerProjectRegistration(name, configRoot, baseDomain, domains);
  info(`registered ${domains.length} static domain${domains.length === 1 ? "" : "s"}`);
  console.log();

  success(`Project '${name}' registered — https://${baseDomain} is live`);
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
    error(".wtenv.config.js already exists. Use --force to overwrite.");
    process.exit(1);
  }

  const name = detectProjectName(cwd) ?? "myapp";

  writeFileSync(outPath, buildProjectConfig(name));

  success(`Created .wtenv.config.js with project block for "${name}"`);
  console.log();
  console.log("Next steps:");
  console.log("  1. Edit .wtenv.config.js — set domains/ports for your services");
  console.log("  2. Run wtenv project register to register the project's static domains");
}

export async function projectDeregister(opts: ProjectOptions = {}): Promise<void> {
  const configRoot = opts.configRoot ? resolve(opts.configRoot) : resolveConfigRoot();
  const config = await loadConfig(configRoot);

  if (!config.project) {
    error("No 'project' section found in .wtenv.config.js");
    process.exit(1);
  }

  const { name, baseDomain, domains } = config.project;

  header(`Deregistering project '${name}' (${baseDomain})`);
  console.log();

  step("caddy");
  await deregisterProjectCaddy(name, domains);
  info("removed routes");
  console.log();

  step("dns");
  // Track whether the resolver file actually existed so we report accurately —
  // when the TLD has a global resolver (e.g. /etc/resolver/test) the per-domain
  // resolver file was never created, so claiming to "remove" it would be a lie.
  const resolverPath = `/etc/resolver/${baseDomain}`;
  const hadResolver = existsSync(resolverPath);
  deregisterProjectDnsmasq(name, baseDomain);
  info(`removed dnsmasq.d/project-${name}.conf`);
  if (hadResolver) info(`removed ${resolverPath}`);
  const bareLocals = bareLocalHostnames(baseDomain, domains.map((d) => d.hostname));
  deregisterMdnsHosts(name);
  if (bareLocals.length > 0) {
    info(`removed mDNS LaunchAgent (wtenv.mdns.${name})`);
  }
  deregisterHostsEntries(name);
  console.log();

  step("registry");
  releaseProjectRegistration(name);
  info("removed project registration");
  console.log();

  success(`Project '${name}' deregistered`);
}
