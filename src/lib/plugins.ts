import { cpSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { registerDnsmasq, deregisterDnsmasq } from "./dnsmasq.js";
import { registerCaddy, deregisterCaddy } from "./caddy.js";
import { bareLocalHostnames, registerMdnsHosts, deregisterMdnsHosts } from "./mdns.js";
import { provisionDatabase, teardownDatabase } from "./database.js";
import { allocateWorktree, releaseWorktree } from "./registry.js";
import { info, cmd, warn } from "./log.js";
import type { Plugin, PluginContext, DatabaseConfig } from "./config.js";

export interface PortsPlugin extends Plugin {
  portRange: [number, number];
}

// Allocates the worktree's registry row, including a checked-out city from the
// bundled pool and per-service ports. Also seeds `ctx.city` and exports
// `WTENV_CITY` so downstream plugins (and the consuming app) can read it.
export function ports(options?: { portRange?: [number, number] }): PortsPlugin {
  const portRange: [number, number] = options?.portRange ?? [3100, 4099];
  return {
    name: "wtenv:ports",
    portRange,
    onRegister(ctx) {
      const serviceNames = Object.keys(ctx.config.services);
      const { city, ports: allocated } = allocateWorktree(
        ctx.worktreeId,
        ctx.worktreeName,
        ctx.cwd,
        serviceNames,
        portRange
      );
      ctx.city = city;
      Object.assign(ctx.ports, allocated);
      ctx.envVars.WTENV_CITY = city;
      info(`city: ${city}`);
      const portList = Object.entries(allocated)
        .map(([s, p]) => `${s}=${p}`)
        .join("  ");
      info(`ports: ${portList}`);
    },
    onDeregister(ctx) {
      releaseWorktree(ctx.worktreeId);
      info(`released city '${ctx.city}' and ports`);
    },
  };
}

export function dns(): Plugin {
  return {
    name: "wtenv:dns",
    onRegister(ctx) {
      registerDnsmasq(ctx.city, ctx.config.tld);
      info(`wrote dnsmasq.d/${ctx.city}.conf`);
      // For tld: 'local', also publish the bare 2-label name via mDNS since /etc/resolver
      // files don't intercept bare .local queries before mDNSResponder.
      const bareLocals = bareLocalHostnames(`${ctx.city}.${ctx.config.tld}`, []);
      if (bareLocals.length > 0) {
        registerMdnsHosts(ctx.city, bareLocals);
        info(`published mDNS for ${bareLocals.join(", ")}`);
      }
    },
    onDeregister(ctx) {
      deregisterMdnsHosts(ctx.city);
      deregisterDnsmasq(ctx.city, ctx.config.tld);
      info(`removed dnsmasq.d/${ctx.city}.conf`);
    },
  };
}

export function caddy(): Plugin {
  return {
    name: "wtenv:caddy",
    async onRegister(ctx) {
      const serviceHostnames: Record<string, string> = Object.fromEntries(
        Object.entries(ctx.config.services).map(([name, cfg]) => [name, cfg.hostname])
      );
      await registerCaddy(ctx.city, ctx.config.tld, ctx.ports, serviceHostnames);
      const n = Object.keys(serviceHostnames).length;
      info(`added ${n} route${n === 1 ? "" : "s"} for ${ctx.city}.${ctx.config.tld}`);
    },
    async onDeregister(ctx) {
      await deregisterCaddy(ctx.city, ctx.config.tld);
      info(`removed routes for ${ctx.city}.${ctx.config.tld}`);
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
        const hostname = cfg.hostname === "*" ? "" : cfg.hostname;
        const domain = `${ctx.city}.${ctx.config.tld}`;
        const fqdn = hostname ? `${hostname}.${domain}` : domain;
        const vars: Record<string, string> = {
          port: String(port),
          worktree: ctx.worktreeName,
          city: ctx.city,
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

export interface CopyFilesOptions {
  files: Array<string | { src: string; dest?: string; optional?: boolean }>;
}

export function copyFiles(options: CopyFilesOptions): Plugin {
  return {
    name: "wtenv:copy-files",
    onRegister(ctx: PluginContext) {
      if (ctx.configRoot === ctx.cwd) {
        warn("configRoot === cwd, skipping copy-files");
        return;
      }
      let copied = 0;
      let skipped = 0;
      for (const entry of options.files) {
        const isObject = typeof entry === "object" && entry !== null && !Array.isArray(entry);
        if (typeof entry !== "string" && !isObject) {
          throw new Error(
            `copy-files: entry must be a string or { src, dest?, optional? }, got: ${JSON.stringify(entry)}`
          );
        }
        if (isObject && typeof entry.src !== "string") {
          throw new Error(
            `copy-files: entry is missing required 'src' string, got: ${JSON.stringify(entry)}`
          );
        }
        const src = typeof entry === "string" ? entry : entry.src;
        const dest = typeof entry === "string" ? entry : (entry.dest ?? entry.src);
        const optional = typeof entry !== "string" && (entry.optional ?? false);
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
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(srcPath, destPath, { recursive: true });
        copied++;
      }
      const summary = `copied ${copied} file${copied === 1 ? "" : "s"}` +
        (skipped > 0 ? ` (${skipped} optional skipped)` : "");
      info(summary);
    },
  };
}

export interface ShellOptions {
  onRegister?: string[];
  onDeregister?: string[];
}

export function shell(options: ShellOptions): Plugin {
  return {
    name: "wtenv:shell",
    onRegister(ctx: PluginContext) {
      runCommands(options.onRegister ?? [], ctx);
    },
    onDeregister(ctx: PluginContext) {
      runCommands(options.onDeregister ?? [], ctx);
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

function runCommands(commands: string[], ctx: PluginContext): void {
  const env = composeWorktreeEnv(ctx);
  for (const command of commands) {
    cmd(command);
    const result = spawnSync(command, { shell: true, stdio: "inherit", cwd: ctx.cwd, env });
    if (result.status !== 0) {
      throw new Error(`shell: command failed (exit ${result.status ?? "?"}): ${command}`);
    }
  }
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
    onRegister(ctx: PluginContext) {
      const dbUrl = provisionDatabase(ctx.city, options);
      ctx.envVars[options.envVar] = dbUrl;
    },
    onDeregister(ctx: PluginContext) {
      teardownDatabase(ctx.city, options);
    },
  };
}
