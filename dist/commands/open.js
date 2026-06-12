import { spawn } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { getWorktree } from "../lib/registry.js";
import { gitRoot, worktreeId, worktreeRoot } from "../lib/git.js";
import { header, error } from "../lib/log.js";
// In --print mode, emit just the URL so it can be piped/captured.
// Otherwise announce what we're opening, then fork `open` and unref so the CLI
// returns immediately (the browser launches asynchronously).
function launch(url, print) {
    if (print) {
        console.log(url);
        return;
    }
    header(`Opening ${url}`);
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}
export async function open(arg, opts = {}) {
    const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    const configRoot = opts.configRoot ?? gitRoot(cwd) ?? cwd;
    const id = worktreeId(cwd);
    if (!id) {
        throw new Error(`Could not determine git-dir for ${cwd} — run inside a git worktree.`);
    }
    const wt = getWorktree(id);
    if (!wt) {
        error(`No registered worktree found at '${cwd}'. Run wtenv register first.`);
        process.exit(1);
    }
    const config = await loadConfig(configRoot);
    // arg resolution: service → alias → literal subdomain → root.
    // Services win over aliases on a name collision (they're "real" — they have
    // ports + Caddy routes).
    let subdomain = "";
    if (arg) {
        const service = config.services[arg];
        const alias = config.aliases?.[arg];
        if (service) {
            subdomain = service.hostname === "*" || service.hostname === false ? "" : service.hostname;
        }
        else if (alias !== undefined) {
            subdomain = alias;
        }
        else {
            subdomain = arg;
        }
    }
    const host = subdomain ? `${subdomain}.${wt.city}.${config.tld}` : `${wt.city}.${config.tld}`;
    launch(`https://${host}`, opts.print ?? false);
}
export async function projectOpen(arg, opts = {}) {
    const configRoot = opts.configRoot ?? gitRoot() ?? process.cwd();
    const config = await loadConfig(configRoot);
    if (!config.project) {
        error("No project config found in .wtenv.config.js");
        process.exit(1);
    }
    // project open has no services — arg resolution is just alias → literal.
    let prefix = "";
    if (arg) {
        prefix = config.aliases?.[arg] ?? arg;
    }
    const host = prefix ? `${prefix}.${config.project.baseDomain}` : config.project.baseDomain;
    launch(`https://${host}`, opts.print ?? false);
}
