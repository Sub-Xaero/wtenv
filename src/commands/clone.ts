import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { gitRoot } from "../lib/git.js";
import { register } from "./register.js";
import { header } from "../lib/log.js";

interface CloneOptions {
  envFile?: string;
}

export async function clone(
  branch: string,
  pathOverride: string | undefined,
  opts: CloneOptions = {}
): Promise<void> {
  const repoRoot = gitRoot();
  if (!repoRoot) throw new Error("Not inside a git repository.");

  const sanitized = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
  const worktreePath = pathOverride
    ? resolve(pathOverride)
    : resolve(dirname(repoRoot), sanitized);

  header(`Creating worktree for '${branch}' at ${worktreePath}`);

  const result = spawnSync("git", ["worktree", "add", worktreePath, branch], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`git worktree add failed (exit ${result.status})`);
  }

  await register(undefined, { cwd: worktreePath, envFile: opts.envFile });
}
