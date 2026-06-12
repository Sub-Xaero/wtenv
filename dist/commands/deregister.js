import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { getWorktree, getWorktreePorts, getWorktreeByCity, listWorktrees } from "../lib/registry.js";
import { worktreeRoot, gitRoot, worktreeId } from "../lib/git.js";
import { detectCaddyConflict } from "../lib/caddy.js";
import { header, step, info, success, error, warn } from "../lib/log.js";
function shortName(pluginName) {
    return pluginName.replace(/^wtenv:/, "");
}
export async function deregister(name, opts = {}) {
    let cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    let id = opts.id;
    if (!id && opts.city) {
        const byCity = getWorktreeByCity(opts.city);
        if (!byCity) {
            error(`No registered worktree found with city '${opts.city}'.`);
            process.exit(1);
        }
        id = byCity.id;
        cwd = opts.cwd ?? byCity.project_root;
        name = name ?? byCity.name;
    }
    if (!id)
        id = worktreeId(cwd) ?? undefined;
    if (!id) {
        throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
    }
    const configRoot = opts.configRoot ?? gitRoot(cwd) ?? cwd;
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
    const conflict = detectCaddyConflict();
    if (conflict) {
        console.log();
        warn(conflict);
    }
}
export async function deregisterStale(opts = {}) {
    const stale = listWorktrees().filter((wt) => !existsSync(wt.id));
    if (stale.length === 0) {
        info("No stale entries found");
        return;
    }
    header(`Removing ${stale.length} stale ${stale.length === 1 ? "entry" : "entries"}`);
    console.log();
    let failures = 0;
    for (const wt of stale) {
        try {
            await deregister(wt.name, { id: wt.id, cwd: wt.project_root, envFile: opts.envFile });
            console.log();
        }
        catch (err) {
            failures++;
            warn(`failed to deregister '${wt.name}': ${err instanceof Error ? err.message : err}`);
        }
    }
    if (failures === 0) {
        success(`Cleaned up ${stale.length} stale ${stale.length === 1 ? "entry" : "entries"}`);
    }
    else {
        warn(`Finished with ${failures} failure${failures === 1 ? "" : "s"}`);
    }
}
