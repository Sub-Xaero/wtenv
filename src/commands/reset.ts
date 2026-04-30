import { listWorktrees } from "../lib/registry.js";
import { deregister } from "./deregister.js";

export async function reset(): Promise<void> {
  const worktrees = listWorktrees();

  if (worktrees.length === 0) {
    console.log("No registered worktrees.");
    return;
  }

  for (const wt of worktrees) {
    try {
      await deregister(wt.name, { cwd: wt.project_root });
    } catch (err) {
      console.error(`Failed to deregister '${wt.name}': ${err instanceof Error ? err.message : err}`);
    }
  }
}
