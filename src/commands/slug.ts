import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { BUNDLED_ANIMALS } from "../lib/animals.js";
import { loadConfig } from "../lib/config.js";
import { registerCaddy, deregisterCaddy } from "../lib/caddy.js";
import { registerDnsmasq, deregisterDnsmasq } from "../lib/dnsmasq.js";
import { bareLocalHostnames, registerMdnsHosts, deregisterMdnsHosts } from "../lib/mdns.js";
import {
  getWorktree,
  getWorktreePorts,
  listWorktrees,
  renameWorktreeSlug,
  validateSlug,
} from "../lib/registry.js";
import { resolveConfigRoot, worktreeId, worktreeRoot } from "../lib/git.js";
import { header, info, success, c } from "../lib/log.js";

interface SlugOptions {
  json?: boolean;
}

interface RenameSlugOptions {
  cwd?: string;
  configRoot?: string;
  envFile?: string;
}

export function listSlugs(options: SlugOptions = {}): void {
  const worktrees = listWorktrees();
  const bySlug = new Map(worktrees.map((wt) => [wt.slug, wt]));
  const slugs = BUNDLED_ANIMALS.map((slug) => {
    const wt = bySlug.get(slug);
    return {
      slug,
      available: !wt,
      worktree: wt
        ? {
            id: wt.id,
            name: wt.name,
            projectRoot: wt.project_root,
          }
        : null,
    };
  });

  if (options.json) {
    console.log(JSON.stringify({ slugs }, null, 2));
    return;
  }

  header("wtenv slugs");
  const taken = slugs.filter((s) => !s.available);
  info(`${slugs.length - taken.length} available, ${taken.length} taken`);
  for (const entry of taken) {
    info(`${entry.slug.padEnd(16)} ${entry.worktree?.name ?? ""}`);
  }
}

function serviceHostnames(config: Awaited<ReturnType<typeof loadConfig>>): Record<string, string | false> {
  return Object.fromEntries(
    Object.entries(config.services).map(([name, cfg]) => [name, cfg.hostname])
  );
}

function renderServiceEnv(
  slug: string,
  tld: string,
  worktreeName: string,
  services: Awaited<ReturnType<typeof loadConfig>>["services"],
  ports: Record<string, number>
): Record<string, string> {
  const env: Record<string, string> = {
    WTENV_SLUG: slug,
    WTENV_DOMAIN: `${slug}.${tld}`,
  };
  for (const [name, cfg] of Object.entries(services)) {
    const port = ports[name];
    if (port === undefined || !cfg.env) continue;
    const hostname = cfg.hostname === "*" || cfg.hostname === false ? "" : cfg.hostname;
    const domain = `${slug}.${tld}`;
    const fqdn = hostname ? `${hostname}.${domain}` : domain;
    const vars: Record<string, string> = {
      port: String(port),
      worktree: worktreeName,
      slug,
      tld,
      hostname,
      domain,
      fqdn,
    };
    for (const [key, template] of Object.entries(cfg.env)) {
      env[key] = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
    }
  }
  return env;
}

function updateEnvFile(path: string, generated: Record<string, string>): void {
  const existing = existsSync(path)
    ? (parseEnv(readFileSync(path, "utf8")) as Record<string, string>)
    : {};
  const merged = { ...existing, ...generated };
  writeFileSync(path, Object.entries(merged).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
}

export async function renameSlug(slug: string, options: RenameSlugOptions = {}): Promise<void> {
  validateSlug(slug);

  const cwd = options.cwd ?? worktreeRoot() ?? process.cwd();
  const id = worktreeId(cwd);
  if (!id) {
    throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
  }

  const wt = getWorktree(id);
  if (!wt) {
    throw new Error(`No registered worktree found at '${cwd}'. Run wtenv register first.`);
  }
  if (wt.slug === slug) {
    success(`Slug is already '${slug}'`);
    return;
  }

  const configRoot = options.configRoot ?? resolveConfigRoot(cwd);
  const config = await loadConfig(configRoot);
  const ports = getWorktreePorts(id);
  const oldSlug = wt.slug;

  header(`Renaming slug '${oldSlug}' → '${slug}'`);
  deregisterMdnsHosts(oldSlug);
  deregisterDnsmasq(oldSlug, config.tld);
  await deregisterCaddy(oldSlug, config.tld);

  try {
    renameWorktreeSlug(id, slug);
    registerDnsmasq(slug, config.tld);
    const bareLocals = bareLocalHostnames(`${slug}.${config.tld}`, []);
    if (bareLocals.length > 0) registerMdnsHosts(slug, bareLocals);
    await registerCaddy(slug, config.tld, ports, serviceHostnames(config));
  } catch (err) {
    renameWorktreeSlug(id, oldSlug);
    registerDnsmasq(oldSlug, config.tld);
    await registerCaddy(oldSlug, config.tld, ports, serviceHostnames(config));
    throw err;
  }

  updateEnvFile(
    join(cwd, options.envFile ?? ".env.worktree"),
    renderServiceEnv(slug, config.tld, wt.name, config.services, ports)
  );

  success(`Renamed '${wt.name}' to ${c.bold(`${slug}.${config.tld}`)}`);
}
