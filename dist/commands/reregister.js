import { getWorktree } from "../lib/registry.js";
import { worktreeRoot, worktreeId } from "../lib/git.js";
import { deregister } from "./deregister.js";
import { register } from "./register.js";
export async function reregister(name, opts = {}) {
    const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    const id = worktreeId(cwd);
    const existing = id ? getWorktree(id) : null;
    const worktreeName = name ?? (opts.keepName ? existing?.name : undefined);
    const slug = opts.keepName ? existing?.slug : undefined;
    if (existing) {
        await deregister(worktreeName, { cwd, configRoot: opts.configRoot, envFile: opts.envFile });
    }
    await register(worktreeName, { ...opts, cwd, slug });
}
