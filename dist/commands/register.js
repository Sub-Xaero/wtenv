import { writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { loadConfig } from "../lib/config.js";
import { worktreeRoot, gitRoot, worktreeId } from "../lib/git.js";
import { detectCaddyConflict } from "../lib/caddy.js";
import { header, step, info, success, error, warn, c } from "../lib/log.js";
function shortName(pluginName) {
    return pluginName.replace(/^wtenv:/, "");
}
export async function register(name, opts = {}) {
    const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    const configRoot = opts.configRoot ?? gitRoot(cwd) ?? cwd;
    const id = worktreeId(cwd);
    if (!id) {
        throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
    }
    const worktreeName = name ?? basename(cwd);
    const config = await loadConfig(configRoot);
    if (opts.dryRun) {
        const portsPlugin = config.plugins.find((p) => p.name === "wtenv:ports");
        const [rangeStart] = portsPlugin?.portRange ?? [3100, 4099];
        header(`Dry run: registering '${worktreeName}'`);
        console.log(`    ${c.dim("id:")}     ${id}`);
        console.log(`    ${c.dim("cwd:")}    ${cwd}`);
        console.log(`    ${c.dim("config:")} ${configRoot}`);
        console.log();
        step("would allocate");
        let nextPort = rangeStart;
        for (const [service, cfg] of Object.entries(config.services)) {
            const hostname = cfg.hostname === false
                ? null
                : cfg.hostname === "*"
                    ? `*.<city>.${config.tld}`
                    : `${cfg.hostname}.<city>.${config.tld}`;
            info(`${service}: port ${nextPort}${hostname ? `  →  https://${hostname}` : ""}`);
            nextPort++;
        }
        console.log();
        step("plugins");
        info(config.plugins.map((p) => shortName(p.name)).join(", "));
        return;
    }
    const envVars = {};
    // city is populated by the ports plugin during onRegister
    const ctx = {
        worktreeId: id,
        worktreeName,
        city: "",
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
    const completed = [];
    try {
        for (let i = 0; i < config.plugins.length; i++) {
            const plugin = config.plugins[i];
            step(shortName(plugin.name));
            await plugin.onRegister?.(ctx);
            completed.push(i);
            console.log();
        }
    }
    catch (err) {
        error("Plugin failed — rolling back...");
        for (const i of [...completed].reverse()) {
            try {
                await config.plugins[i].onDeregister?.(ctx);
            }
            catch { }
        }
        throw err;
    }
    const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
    writeFileSync(envFilePath, Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n");
    success(`Registered '${worktreeName}' as ${ctx.city}.${config.tld}`);
    for (const [service, port] of Object.entries(ctx.ports)) {
        const cfg = config.services[service];
        const hostname = cfg.hostname === false
            ? null
            : cfg.hostname === "*"
                ? `*.${ctx.city}.${config.tld}`
                : `${cfg.hostname}.${ctx.city}.${config.tld}`;
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
