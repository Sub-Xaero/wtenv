import { writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { loadConfig } from "../lib/config.js";
import type { PluginContext } from "../lib/config.js";
import type { PortsPlugin } from "../lib/plugins.js";
import { worktreeRoot, gitRoot, worktreeId } from "../lib/git.js";
import { detectCaddyConflict } from "../lib/caddy.js";
import { header, step, info, success, error, warn, c } from "../lib/log.js";

interface RegisterOptions {
  cwd?: string;
  configRoot?: string;
  envFile?: string;
  dryRun?: boolean;
  slug?: string;
}

function shortName(pluginName: string): string {
  return pluginName.replace(/^wtenv:/, "");
}

export async function register(
  name: string | undefined,
  opts: RegisterOptions = {}
): Promise<void> {
  const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
  const configRoot = opts.configRoot ?? gitRoot(cwd) ?? cwd;
  const id = worktreeId(cwd);
  if (!id) {
    throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
  }
  const worktreeName = name ?? basename(cwd);
  const config = await loadConfig(configRoot);
  const portsPlugin = config.plugins.find((p) => p.name === "wtenv:ports") as
    | PortsPlugin
    | undefined;
  if (opts.slug && portsPlugin) portsPlugin.slugHint = opts.slug;

  if (opts.dryRun) {
    const [rangeStart] = portsPlugin?.portRange ?? [3100, 4099];
    const slug = opts.slug ?? "<slug>";
    header(`Dry run: registering '${worktreeName}'`);
    console.log(`    ${c.dim("id:")}     ${id}`);
    console.log(`    ${c.dim("cwd:")}    ${cwd}`);
    console.log(`    ${c.dim("config:")} ${configRoot}`);
    if (opts.slug) console.log(`    ${c.dim("slug:")}   ${opts.slug}`);
    console.log();
    step("would allocate");
    let nextPort = rangeStart;
    for (const [service, cfg] of Object.entries(config.services)) {
      const hostname =
        cfg.hostname === false
          ? null
          : cfg.hostname === "*"
          ? `*.${slug}.${config.tld}`
          : `${cfg.hostname}.${slug}.${config.tld}`;
      info(`${service}: port ${nextPort}${hostname ? `  →  https://${hostname}` : ""}`);
      nextPort++;
    }
    console.log();
    step("plugins");
    info(config.plugins.map((p) => shortName(p.name)).join(", "));
    return;
  }

  const envVars: Record<string, string> = {};
  // slug is populated by the ports plugin during onRegister
  const ctx: PluginContext = {
    worktreeId: id,
    worktreeName,
    slug: "",
    cwd,
    configRoot,
    ports: {},
    envVars,
    config,
  };

  header(`Registering '${worktreeName}'`);
  console.log(`    ${c.dim("id:")}     ${id}`);
  console.log(`    ${c.dim("cwd:")}    ${cwd}`);
  console.log(`    ${c.dim("config:")} ${configRoot}`);
  console.log();

  const completed: number[] = [];
  try {
    for (let i = 0; i < config.plugins.length; i++) {
      const plugin = config.plugins[i];
      step(shortName(plugin.name));
      await plugin.onRegister?.(ctx);
      completed.push(i);
      console.log();
    }
  } catch (err) {
    error("Plugin failed — rolling back...");
    for (const i of [...completed].reverse()) {
      try {
        await config.plugins[i].onDeregister?.(ctx);
      } catch {}
    }
    throw err;
  }

  const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
  writeFileSync(
    envFilePath,
    Object.entries(envVars)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n"
  );

  success(`Registered '${worktreeName}' as ${ctx.slug}.${config.tld}`);
  for (const [service, port] of Object.entries(ctx.ports)) {
    const cfg = config.services[service];
    const hostname =
      cfg.hostname === false
        ? null
        : cfg.hostname === "*"
        ? `*.${ctx.slug}.${config.tld}`
        : `${cfg.hostname}.${ctx.slug}.${config.tld}`;
    console.log(`    ${service.padEnd(10)} :${port}${hostname ? `   https://${hostname}` : ""}`);
  }
  const envRel = relative(cwd, envFilePath) || envFilePath;
  console.log(`    ${c.dim("env file:")} ${envRel}`);

  const conflict = detectCaddyConflict();
  if (conflict) {
    console.log();
    warn(conflict);
  }
}
