import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { worktreeRoot, gitRoot, worktreeId } from "../lib/git.js";
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
        console.log(`Dry run for '${worktreeName}'\n  id:     ${id}\n  cwd:    ${cwd}\n  config: ${configRoot}\n`);
        console.log("Would allocate ports + a city (city assigned at register time):");
        let nextPort = rangeStart;
        for (const [service, cfg] of Object.entries(config.services)) {
            const hostname = cfg.hostname === "*"
                ? `*.<city>.${config.tld}`
                : `${cfg.hostname}.<city>.${config.tld}`;
            console.log(`  ${service}: port ${nextPort}  →  https://${hostname}`);
            nextPort++;
        }
        console.log(`\nPlugins: ${config.plugins.map((p) => p.name).join(", ")}`);
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
    const completed = [];
    try {
        for (let i = 0; i < config.plugins.length; i++) {
            await config.plugins[i].onRegister?.(ctx);
            completed.push(i);
        }
    }
    catch (err) {
        console.error("\nPlugin failed — rolling back...");
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
    console.log(`Registered worktree '${worktreeName}' as ${ctx.city}.${config.tld}`);
    console.log();
    for (const [service, port] of Object.entries(ctx.ports)) {
        const cfg = config.services[service];
        const hostname = cfg.hostname === "*"
            ? `*.${ctx.city}.${config.tld}`
            : `${cfg.hostname}.${ctx.city}.${config.tld}`;
        console.log(`  ${service.padEnd(10)} :${port}   https://${hostname}`);
    }
    console.log();
    console.log(`Env vars written to ${envFilePath}`);
}
