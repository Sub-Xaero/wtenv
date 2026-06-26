import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { parseEnv } from "node:util";
import { registerDnsmasq, deregisterDnsmasq } from "./dnsmasq.js";
import { registerCaddy, deregisterCaddy } from "./caddy.js";
import { bareLocalHostnames, registerMdnsHosts, deregisterMdnsHosts } from "./mdns.js";
import { provisionDatabase, teardownDatabase } from "./database.js";
import { provisionRedis, teardownRedis } from "./redis.js";
import { allocateWorktree, releaseWorktree, allocateRedisDb, releaseRedisDb, getRedisDb } from "./registry.js";
import { info, cmd, warn } from "./log.js";
import { executePlan } from "./plan.js";
import type { Plugin, PluginContext, DatabaseConfig } from "./config.js";
import type { PlanInput } from "./plan.js";

export interface PortsPlugin extends Plugin {
  portRange: [number, number];
  slugHint?: string;
}

// Allocates the worktree's registry row, including a checked-out animal name
// (the slug) from the bundled pool and per-service ports. Also seeds `ctx.slug`
// and exports `WTENV_SLUG` (the bare label) plus `WTENV_DOMAIN` (slug.tld) so
// downstream plugins (and the consuming app) can read them.
export function ports(options?: { portRange?: [number, number]; slug?: string }): PortsPlugin {
  const portRange: [number, number] = options?.portRange ?? [3100, 4099];
  return {
    name: "wtenv:ports",
    portRange,
    slugHint: options?.slug,
    onRegister(ctx) {
      const serviceNames = Object.keys(ctx.config.services);
      const { slug, ports: allocated } = allocateWorktree(
        ctx.worktreeId,
        ctx.worktreeName,
        ctx.cwd,
        serviceNames,
        portRange,
        { slugHint: this.slugHint }
      );
      ctx.slug = slug;
      Object.assign(ctx.ports, allocated);
      ctx.envVars.WTENV_SLUG = slug;
      ctx.envVars.WTENV_DOMAIN = `${slug}.${ctx.config.tld}`;
      info(`slug: ${slug}`);
      const portList = Object.entries(allocated)
        .map(([s, p]) => `${s}=${p}`)
        .join("  ");
      info(`ports: ${portList}`);
    },
    onDeregister(ctx) {
      releaseWorktree(ctx.worktreeId);
      info(`released slug '${ctx.slug}' and ports`);
    },
  };
}

export function dns(): Plugin {
  return {
    name: "wtenv:dns",
    onRegister(ctx) {
      registerDnsmasq(ctx.slug, ctx.config.tld);
      info(`wrote dnsmasq.d/${ctx.slug}.conf`);
      // For tld: 'local', also publish the bare 2-label name via mDNS since /etc/resolver
      // files don't intercept bare .local queries before mDNSResponder.
      const bareLocals = bareLocalHostnames(`${ctx.slug}.${ctx.config.tld}`, []);
      if (bareLocals.length > 0) {
        registerMdnsHosts(ctx.slug, bareLocals);
        info(`published mDNS for ${bareLocals.join(", ")}`);
      }
    },
    onDeregister(ctx) {
      deregisterMdnsHosts(ctx.slug);
      deregisterDnsmasq(ctx.slug, ctx.config.tld);
      info(`removed dnsmasq.d/${ctx.slug}.conf`);
    },
  };
}

export function caddy(): Plugin {
  return {
    name: "wtenv:caddy",
    async onRegister(ctx) {
      const serviceHostnames: Record<string, string | false> = Object.fromEntries(
        Object.entries(ctx.config.services).map(([name, cfg]) => [name, cfg.hostname])
      );
      await registerCaddy(ctx.slug, ctx.config.tld, ctx.ports, serviceHostnames);
      const n = Object.keys(serviceHostnames).length;
      info(`added ${n} route${n === 1 ? "" : "s"} for ${ctx.slug}.${ctx.config.tld}`);
    },
    async onDeregister(ctx) {
      await deregisterCaddy(ctx.slug, ctx.config.tld);
      info(`removed routes for ${ctx.slug}.${ctx.config.tld}`);
    },
  };
}

export function serviceEnv(): Plugin {
  return {
    name: "wtenv:service-env",
    onRegister(ctx) {
      let count = 0;
      for (const [name, cfg] of Object.entries(ctx.config.services)) {
        const port = ctx.ports[name];
        if (port === undefined || !cfg.env) continue;
        const hostname = cfg.hostname === "*" || cfg.hostname === false ? "" : cfg.hostname;
        const domain = `${ctx.slug}.${ctx.config.tld}`;
        const fqdn = hostname ? `${hostname}.${domain}` : domain;
        const vars: Record<string, string> = {
          port: String(port),
          worktree: ctx.worktreeName,
          slug: ctx.slug,
          tld: ctx.config.tld,
          hostname,
          domain,
          fqdn,
        };
        for (const [key, template] of Object.entries(cfg.env)) {
          ctx.envVars[key] = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
          count++;
        }
      }
      info(`expanded ${count} env var${count === 1 ? "" : "s"}`);
    },
  };
}

export function defaultPlugins(opts?: { portRange?: [number, number] }): Plugin[] {
  return [ports(opts), dns(), caddy(), serviceEnv()];
}

export interface CopyFilesEntry {
  src: string;
  dest?: string;
  optional?: boolean;
  // When true, symlink dest → src (in configRoot) instead of copying. The link
  // is removed again on deregister. Use for shared, mutable directories that
  // should stay in sync across worktrees (e.g. Active Storage `storage/`).
  symlink?: boolean;
}

export interface CopyFilesOptions {
  files: Array<string | CopyFilesEntry>;
  // Distinguishes this instance in the register/deregister step log when a
  // config uses more than one copyFiles(). Shown as `copy-files:<label>`.
  label?: string;
}

interface NormalizedCopyEntry {
  src: string;
  dest: string;
  optional: boolean;
  symlink: boolean;
}

function normalizeCopyEntry(entry: string | CopyFilesEntry): NormalizedCopyEntry {
  const isObject = typeof entry === "object" && entry !== null && !Array.isArray(entry);
  if (typeof entry !== "string" && !isObject) {
    throw new Error(
      `copy-files: entry must be a string or { src, dest?, optional?, symlink? }, got: ${JSON.stringify(entry)}`
    );
  }
  if (isObject && typeof entry.src !== "string") {
    throw new Error(
      `copy-files: entry is missing required 'src' string, got: ${JSON.stringify(entry)}`
    );
  }
  return {
    src: typeof entry === "string" ? entry : entry.src,
    dest: typeof entry === "string" ? entry : (entry.dest ?? entry.src),
    optional: typeof entry !== "string" && (entry.optional ?? false),
    symlink: typeof entry !== "string" && (entry.symlink ?? false),
  };
}

// lstat-based existence checks so we inspect the link itself, never its target:
// `pathPresent` is true for a real file/dir or any symlink (incl. broken ones),
// and `isSymlink` distinguishes links we created from real worktree data.
function pathPresent(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function copyFiles(options: CopyFilesOptions): Plugin {
  return {
    name: options.label ? `wtenv:copy-files:${options.label}` : "wtenv:copy-files",
    onRegister(ctx: PluginContext) {
      if (ctx.configRoot === ctx.cwd) {
        warn("configRoot === cwd, skipping copy-files");
        return;
      }
      let copied = 0;
      let linked = 0;
      let skipped = 0;
      for (const entry of options.files) {
        const { src, dest, optional, symlink } = normalizeCopyEntry(entry);
        const srcPath = join(ctx.configRoot, src);
        const destPath = join(ctx.cwd, dest);
        if (!existsSync(srcPath)) {
          if (optional) {
            info(`skipping optional '${src}' (not found)`);
            skipped++;
            continue;
          }
          throw new Error(`copy-files: required file not found: ${srcPath}`);
        }
        if (symlink) {
          // Never clobber a path the worktree already has — a real file/dir or a
          // pre-existing link (e.g. from a re-register). Leave it untouched.
          if (pathPresent(destPath)) {
            info(`skipping symlink '${dest}' (already exists)`);
            skipped++;
            continue;
          }
          mkdirSync(dirname(destPath), { recursive: true });
          symlinkSync(srcPath, destPath);
          linked++;
        } else {
          mkdirSync(dirname(destPath), { recursive: true });
          cpSync(srcPath, destPath, { recursive: true });
          copied++;
        }
      }
      const parts = [`copied ${copied} file${copied === 1 ? "" : "s"}`];
      if (linked > 0) parts.push(`linked ${linked}`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      info(parts.join(", "));
    },
    onDeregister(ctx: PluginContext) {
      if (ctx.configRoot === ctx.cwd) return;
      let removed = 0;
      for (const entry of options.files) {
        const { dest, symlink } = normalizeCopyEntry(entry);
        if (!symlink) continue;
        const destPath = join(ctx.cwd, dest);
        // Only remove our own symlinks — never a real file/dir that replaced one.
        if (isSymlink(destPath)) {
          unlinkSync(destPath);
          removed++;
        }
      }
      if (removed > 0) info(`removed ${removed} symlink${removed === 1 ? "" : "s"}`);
    },
  };
}

export interface ShellOptions {
  onRegister?: PlanInput<string>;
  onDeregister?: PlanInput<string>;
  // Distinguishes this instance in the register/deregister step log when a
  // config uses more than one shell(). Shown as `shell:<label>`.
  label?: string;
}

export function shell(options: ShellOptions): Plugin {
  return {
    name: options.label ? `wtenv:shell:${options.label}` : "wtenv:shell",
    async onRegister(ctx: PluginContext) {
      await runCommands(options.onRegister ?? [], ctx);
    },
    async onDeregister(ctx: PluginContext) {
      await runCommands(options.onDeregister ?? [], ctx);
    },
  };
}

// The dotenv files direnv layers before the worktree env (`.env.worktree`).
// Shared with the direnv() plugin and `wtenv env export` so register-time,
// run-time, and the manual export path all stay in lockstep.
export const DOTENV_LAYERS = [".env", ".env.local"] as const;

// Reproduce direnv's runtime environment so shell commands see the same vars the
// running app will. Layering matches the generated .envrc:
// process.env < .env < .env.local < ctx.envVars (wtenv-generated values win last).
// ctx.envVars stands in for the `.env.worktree` layer, which isn't written to disk
// until after all plugins finish.
function composeWorktreeEnv(ctx: PluginContext): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const file of DOTENV_LAYERS) {
    const p = join(ctx.cwd, file);
    if (existsSync(p)) Object.assign(env, parseEnv(readFileSync(p, "utf8")));
  }
  Object.assign(env, ctx.envVars);
  return env;
}

async function runCommands(commands: PlanInput<string>, ctx: PluginContext): Promise<void> {
  const env = composeWorktreeEnv(ctx);
  await executePlan(commands, (command) => runCommand(command, ctx, env));
}

function runCommand(command: string, ctx: PluginContext, env: NodeJS.ProcessEnv): Promise<void> {
  cmd(command);
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: "inherit", cwd: ctx.cwd, env });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const status = code === null ? `signal ${signal ?? "?"}` : `exit ${code}`;
      reject(new Error(`shell: command failed (${status}): ${command}`));
    });
  });
}

export interface DirenvOptions {
  envFile?: string;
}

export function direnv(options: DirenvOptions = {}): Plugin {
  const envFile = options.envFile ?? ".env.worktree";
  // Later files override earlier ones in direnv's dotenv loader, so worktree
  // overrides local overrides base. Each line is skipped at eval time if the
  // file isn't present.
  const sources = [...DOTENV_LAYERS, envFile];
  return {
    name: "wtenv:direnv",
    onRegister(ctx: PluginContext) {
      const body = sources.map((f) => `dotenv_if_exists ${f}`).join("\n") + "\n";
      writeFileSync(join(ctx.cwd, ".envrc"), body);
      info(`wrote .envrc (dotenv_if_exists ${sources.join(", ")})`);
    },
    onDeregister(ctx: PluginContext) {
      const envrcPath = join(ctx.cwd, ".envrc");
      if (existsSync(envrcPath)) {
        unlinkSync(envrcPath);
        info("removed .envrc");
      }
    },
  };
}

export function postgres(options: DatabaseConfig): Plugin {
  return {
    name: "wtenv:postgres",
    async onRegister(ctx: PluginContext) {
      const dbUrl = await provisionDatabase(ctx.slug, options);
      ctx.envVars[options.envVar] = dbUrl;
    },
    async onDeregister(ctx: PluginContext) {
      await teardownDatabase(ctx.slug, options);
    },
  };
}

export interface RedisConfig {
  // Env var for the Redis URL written to .env.worktree. Defaults to "REDIS_URL".
  envVar?: string;
  // Host where redis is running. Defaults to "127.0.0.1".
  host?: string;
  // Port where redis is listening. Defaults to 6379.
  port?: number;
  // Whether to FLUSHDB on deregister. Defaults to true.
  flushOnDeregister?: boolean;
  // First logical database index in the allocation pool (inclusive).
  // Set this to reserve lower indices for manual use or the root workspace.
  // Defaults to 0.
  dbStart?: number;
  // Last logical database index in the allocation pool (inclusive).
  // Defaults to 1023.
  dbEnd?: number;
}

export function redis(options: RedisConfig = {}): Plugin {
  const { envVar = "REDIS_URL", host, port, flushOnDeregister, dbStart, dbEnd } = options;
  return {
    name: "wtenv:redis",
    onRegister(ctx: PluginContext) {
      const dbIndex = allocateRedisDb(ctx.worktreeId, { dbStart, dbEnd });
      const url = provisionRedis(ctx.slug, dbIndex, { host, port });
      ctx.envVars[envVar] = url;
    },
    onDeregister(ctx: PluginContext) {
      const dbIndex = getRedisDb(ctx.worktreeId);
      if (dbIndex !== null) {
        teardownRedis(ctx.slug, dbIndex, { host, port, flushOnDeregister });
        releaseRedisDb(ctx.worktreeId);
      }
    },
  };
}
