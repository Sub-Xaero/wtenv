import { unlinkSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { isRegistered } from "../lib/registry.js";
import { worktreeRoot, gitRoot } from "../lib/git.js";
export async function deregister(name, opts = {}) {
    const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    const configRoot = opts.configRoot ?? gitRoot(cwd) ?? cwd;
    const worktreeName = name ?? basename(cwd);
    if (!isRegistered(worktreeName)) {
        console.error(`Worktree '${worktreeName}' is not registered.`);
        process.exit(1);
    }
    const config = await loadConfig(configRoot);
    const ctx = {
        worktreeName,
        cwd,
        configRoot,
        ports: {},
        envVars: {},
        config,
    };
    for (const plugin of [...config.plugins].reverse()) {
        await plugin.onDeregister?.(ctx);
    }
    const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
    if (existsSync(envFilePath)) {
        unlinkSync(envFilePath);
    }
    console.log(`Deregistered worktree '${worktreeName}'`);
}
