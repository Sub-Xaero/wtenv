import { basename } from "node:path";
import { isRegistered } from "../lib/registry.js";
import { worktreeRoot } from "../lib/git.js";
import { deregister } from "./deregister.js";
import { register } from "./register.js";
export async function reregister(name, opts = {}) {
    const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    const worktreeName = name ?? basename(cwd);
    if (isRegistered(worktreeName)) {
        await deregister(worktreeName, { cwd, configRoot: opts.configRoot, envFile: opts.envFile });
    }
    await register(name, opts);
}
