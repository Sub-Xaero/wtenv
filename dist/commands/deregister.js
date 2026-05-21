import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { getWorktree, getWorktreePorts } from "../lib/registry.js";
import { worktreeRoot, gitRoot, worktreeId } from "../lib/git.js";
import { header, step, success, error } from "../lib/log.js";
function shortName(pluginName) {
    return pluginName.replace(/^wtenv:/, "");
}
export async function deregister(name, opts = {}) {
    const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    const configRoot = opts.configRoot ?? gitRoot(cwd) ?? cwd;
    const id = opts.id ?? worktreeId(cwd);
    if (!id) {
        throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
    }
    const wt = getWorktree(id);
    if (!wt) {
        error(`No registered worktree found at '${cwd}'.`);
        process.exit(1);
    }
    const worktreeName = name ?? wt.name;
    const config = await loadConfig(configRoot);
    const ctx = {
        worktreeId: id,
        worktreeName,
        city: wt.city,
        cwd,
        configRoot,
        ports: getWorktreePorts(id),
        envVars: {},
        config,
    };
    header(`Deregistering '${worktreeName}' (${wt.city}.${config.tld})`);
    console.log();
    for (const plugin of [...config.plugins].reverse()) {
        if (!plugin.onDeregister)
            continue;
        step(shortName(plugin.name));
        await plugin.onDeregister(ctx);
        console.log();
    }
    const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
    if (existsSync(envFilePath)) {
        unlinkSync(envFilePath);
    }
    success(`Deregistered '${worktreeName}'`);
}
