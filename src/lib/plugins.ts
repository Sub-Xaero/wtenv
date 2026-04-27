import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { registerDnsmasq, deregisterDnsmasq } from "./dnsmasq.js";
import { registerCaddy, deregisterCaddy } from "./caddy.js";
import { provisionDatabase, teardownDatabase } from "./database.js";
import { allocatePorts, releasePorts } from "./registry.js";
import type { Plugin, PluginContext, DatabaseConfig } from "./config.js";

export interface PortsPlugin extends Plugin {
  portRange: [number, number];
}

export function ports(options?: { portRange?: [number, number] }): PortsPlugin {
  const portRange: [number, number] = options?.portRange ?? [3100, 4099];
  return {
    name: "wtenv:ports",
    portRange,
    onRegister(ctx) {
      const serviceNames = Object.keys(ctx.config.services);
      const allocated = allocatePorts(ctx.worktreeName, ctx.cwd, serviceNames, portRange);
      Object.assign(ctx.ports, allocated);
    },
    onDeregister(ctx) {
      releasePorts(ctx.worktreeName);
    },
  };
}

export function dns(): Plugin {
  return {
    name: "wtenv:dns",
    onRegister(ctx) {
      registerDnsmasq(ctx.worktreeName, ctx.config.tld);
    },
    onDeregister(ctx) {
      deregisterDnsmasq(ctx.worktreeName);
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
      await registerCaddy(ctx.worktreeName, ctx.config.tld, ctx.ports, serviceHostnames);
    },
    async onDeregister(ctx) {
      await deregisterCaddy(ctx.worktreeName);
    },
  };
}

export function serviceEnv(): Plugin {
  return {
    name: "wtenv:service-env",
    onRegister(ctx) {
      for (const [name, cfg] of Object.entries(ctx.config.services)) {
        const port = ctx.ports[name];
        if (port === undefined || !cfg.env) continue;
        const hostname = cfg.hostname === "*" ? "" : cfg.hostname;
        const domain = `${ctx.worktreeName}.${ctx.config.tld}`;
        const fqdn = hostname ? `${hostname}.${domain}` : domain;
        const vars: Record<string, string> = {
          port: String(port),
          worktree: ctx.worktreeName,
          tld: ctx.config.tld,
          hostname,
          domain,
          fqdn,
        };
        for (const [key, template] of Object.entries(cfg.env)) {
          ctx.envVars[key] = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
        }
      }
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
        console.warn("  copy-files: configRoot === cwd, skipping");
        return;
      }
      for (const entry of options.files) {
        const src = typeof entry === "string" ? entry : entry.src;
        const dest = typeof entry === "string" ? entry : (entry.dest ?? entry.src);
        const optional = typeof entry !== "string" && (entry.optional ?? false);
        const srcPath = join(ctx.configRoot, src);
        const destPath = join(ctx.cwd, dest);
        if (!existsSync(srcPath)) {
          if (optional) {
            console.log(`  copy-files: skipping optional '${src}' (not found)`);
            continue;
          }
          throw new Error(`copy-files: required file not found: ${srcPath}`);
        }
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(srcPath, destPath, { recursive: true });
      }
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

function runCommands(commands: string[], ctx: PluginContext): void {
  const env = { ...process.env, ...ctx.envVars };
  for (const cmd of commands) {
    const result = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: ctx.cwd, env });
    if (result.status !== 0) {
      throw new Error(`shell: command failed (exit ${result.status ?? "?"}): ${cmd}`);
    }
  }
}

export function postgres(options: DatabaseConfig): Plugin {
  return {
    name: "wtenv:postgres",
    onRegister(ctx: PluginContext) {
      const dbUrl = provisionDatabase(ctx.worktreeName, options);
      ctx.envVars[options.envVar] = dbUrl;
    },
    onDeregister(ctx: PluginContext) {
      teardownDatabase(ctx.worktreeName, options);
    },
  };
}
