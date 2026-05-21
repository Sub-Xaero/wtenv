import { listWorktrees } from "../lib/registry.js";
import { deregister } from "./deregister.js";
import { header, info, warn, success } from "../lib/log.js";
export async function reset() {
    const worktrees = listWorktrees();
    if (worktrees.length === 0) {
        info("No registered worktrees");
        return;
    }
    header(`Deregistering ${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}`);
    console.log();
    let failures = 0;
    for (const wt of worktrees) {
        try {
            await deregister(wt.name, { id: wt.id, cwd: wt.project_root });
            console.log();
        }
        catch (err) {
            failures++;
            warn(`failed to deregister '${wt.name}': ${err instanceof Error ? err.message : err}`);
        }
    }
    if (failures === 0) {
        success(`Reset ${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}`);
    }
    else {
        warn(`Reset finished with ${failures} failure${failures === 1 ? "" : "s"}`);
    }
}
