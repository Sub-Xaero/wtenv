import { writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { loadConfig } from "../lib/config.js";
import { executePlan, flattenPlan, invertPlan, PlanExecutionError, sequence } from "../lib/plan.js";
import { worktreeRoot, resolveConfigRoot, worktreeId } from "../lib/git.js";
import { detectCaddyConflict } from "../lib/caddy.js";
import { captureLogs, flushCapturedLog, header, step, info, success, error, warn, c } from "../lib/log.js";
function shortName(pluginName) {
    return pluginName.replace(/^wtenv:/, "");
}
export async function register(name, opts = {}) {
    const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    const configRoot = opts.configRoot ?? resolveConfigRoot(cwd);
    const id = worktreeId(cwd);
    if (!id) {
        throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
    }
    const worktreeName = name ?? basename(cwd);
    const config = await loadConfig(configRoot);
    const plugins = flattenPlan(config.plugins);
    const portsPlugin = plugins.find((p) => p.name === "wtenv:ports");
    if (opts.slug && portsPlugin)
        portsPlugin.slugHint = opts.slug;
    if (opts.dryRun) {
        const [rangeStart] = portsPlugin?.portRange ?? [3100, 4099];
        const slug = opts.slug ?? "<slug>";
        header(`Dry run: registering '${worktreeName}'`);
        console.log(`    ${c.dim("id:")}     ${id}`);
        console.log(`    ${c.dim("cwd:")}    ${cwd}`);
        console.log(`    ${c.dim("config:")} ${configRoot}`);
        if (opts.slug)
            console.log(`    ${c.dim("slug:")}   ${opts.slug}`);
        console.log();
        step("would allocate");
        let nextPort = rangeStart;
        for (const [service, cfg] of Object.entries(config.services)) {
            const hostname = cfg.hostname === false
                ? null
                : cfg.hostname === "*"
                    ? `*.${slug}.${config.tld}`
                    : `${cfg.hostname}.${slug}.${config.tld}`;
            info(`${service}: port ${nextPort}${hostname ? `  →  https://${hostname}` : ""}`);
            nextPort++;
        }
        console.log();
        step("plugins");
        info(plugins.map((p) => shortName(p.name)).join(", "));
        return;
    }
    const envVars = {};
    // slug is populated by the ports plugin during onRegister
    const ctx = {
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
    let completed = sequence([]);
    try {
        completed = await executePlan(config.plugins, async (plugin) => {
            if (!plugin.onRegister)
                return false;
            const captured = await captureLogs(async () => {
                step(shortName(plugin.name));
                await plugin.onRegister(ctx);
                console.log();
            });
            flushCapturedLog(captured.output);
            if (!captured.ok)
                throw captured.error;
        });
    }
    catch (err) {
        const completedPlan = err instanceof PlanExecutionError ? err.completed : completed;
        error("Plugin failed — rolling back...");
        await executePlan(invertPlan(completedPlan), async (plugin) => {
            if (!plugin.onDeregister)
                return false;
            try {
                const captured = await captureLogs(() => plugin.onDeregister(ctx));
                flushCapturedLog(captured.output);
            }
            catch { }
        });
        throw err;
    }
    const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
    writeFileSync(envFilePath, Object.entries(envVars)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n");
    success(`Registered '${worktreeName}' as ${ctx.slug}.${config.tld}`);
    for (const [service, port] of Object.entries(ctx.ports)) {
        const cfg = config.services[service];
        const hostname = cfg.hostname === false
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
