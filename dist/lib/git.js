import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
// Root of the current git worktree (linked or main)
export function worktreeRoot(cwd = process.cwd()) {
    try {
        return execSync("git rev-parse --show-toplevel", { cwd, stdio: "pipe" }).toString().trim();
    }
    catch {
        return null;
    }
}
// Root of the main checkout — where .wtenv.config.js lives.
// git-common-dir returns ".git" (relative) for the main worktree, or an absolute
// path like "/main/repo/.git" for linked worktrees. Resolving and taking dirname
// gives the main repo root in both cases.
export function gitRoot(cwd = process.cwd()) {
    try {
        const commonDir = execSync("git rev-parse --git-common-dir", { cwd, stdio: "pipe" }).toString().trim();
        return dirname(resolve(cwd, commonDir));
    }
    catch {
        return null;
    }
}
