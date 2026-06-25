import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

const CONFIG_FILES = [".wtenv.config.js", ".wtenv.json"];

function hasConfig(dir: string | null): dir is string {
  return dir != null && CONFIG_FILES.some((f) => existsSync(join(dir, f)));
}

// Root of the current git worktree (linked or main)
export function worktreeRoot(cwd = process.cwd()): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    return null;
  }
}

// Root of the main checkout — where .wtenv.config.js lives.
// git-common-dir returns ".git" (relative) for the main worktree, or an absolute
// path like "/main/repo/.git" for linked worktrees. Resolving and taking dirname
// gives the main repo root in both cases.
export function gitRoot(cwd = process.cwd()): string | null {
  try {
    const commonDir = execSync("git rev-parse --git-common-dir", { cwd, stdio: "pipe" }).toString().trim();
    return dirname(resolve(cwd, commonDir));
  } catch {
    return null;
  }
}

// Directory to load .wtenv.config.js from. The current worktree's own config
// wins so per-worktree configs take effect; gitRoot (the main checkout) is only
// a fallback for worktrees that don't carry their own config — e.g. when it's
// gitignored and lives only in the main checkout. Finally fall back to cwd.
export function resolveConfigRoot(cwd = process.cwd()): string {
  const local = worktreeRoot(cwd);
  if (hasConfig(local)) return local;
  return gitRoot(cwd) ?? local ?? cwd;
}

// Stable identifier for a worktree. For the main checkout it's `<repo>/.git`;
// for linked worktrees it's `<main>/.git/worktrees/<id>`. Git itself manages
// this path, so it survives directory renames (which conductor does).
export function worktreeId(cwd = process.cwd()): string | null {
  try {
    return execSync("git rev-parse --absolute-git-dir", { cwd, stdio: "pipe" }).toString().trim();
  } catch {
    return null;
  }
}
