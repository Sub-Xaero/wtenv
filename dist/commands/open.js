import { spawn } from "node:child_process";
import https from "node:https";
import { loadConfig } from "../lib/config.js";
import { getWorktree } from "../lib/registry.js";
import { resolveConfigRoot, worktreeId, worktreeRoot } from "../lib/git.js";
import { header, error } from "../lib/log.js";
const DEFAULT_WAIT_TIMEOUT_SECONDS = 60;
const POLL_INTERVAL_MS = 250;
// Caddy itself returns these when the upstream app hasn't come up yet — they
// mean "Caddy is up, the app isn't" rather than "ready."
const GATEWAY_ERROR_STATUS_CODES = new Set([502, 503, 504]);
// A single reachability check: any HTTP response counts as "ready" — even a
// 4xx/5xx from the app itself — except Caddy's own gateway error codes, which
// mean the app behind it isn't answering yet. Cert validation is off — we
// only care that something responded, not who signed its locally-trusted cert.
function probe(url) {
    return new Promise((resolve) => {
        const req = https.get(url, { rejectUnauthorized: false, timeout: 2000 }, (res) => {
            res.resume();
            resolve(!GATEWAY_ERROR_STATUS_CODES.has(res.statusCode ?? 0));
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
            req.destroy();
            resolve(false);
        });
    });
}
async function pollUntilReady(url, timeoutSeconds) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    do {
        if (await probe(url))
            return true;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    } while (Date.now() < deadline);
    return false;
}
// Polls in a detached child so the invoking shell gets its terminal back
// immediately — e.g. a setup script running `wtenv open --wait` before a
// long-running `bin/dev` shouldn't have to wait for the dev server to boot.
function spawnWaitAndOpen(url, timeoutSeconds) {
    const script = `
    const https = require("node:https");
    const { spawn } = require("node:child_process");
    const gatewayErrorStatusCodes = new Set(${JSON.stringify([...GATEWAY_ERROR_STATUS_CODES])});
    const deadline = Date.now() + ${timeoutSeconds * 1000};
    function probe() {
      return new Promise((resolve) => {
        const req = https.get(${JSON.stringify(url)}, { rejectUnauthorized: false, timeout: 2000 }, (res) => {
          res.resume();
          resolve(!gatewayErrorStatusCodes.has(res.statusCode));
        });
        req.on("error", () => resolve(false));
        req.on("timeout", () => { req.destroy(); resolve(false); });
      });
    }
    (async () => {
      do {
        if (await probe()) break;
        await new Promise((r) => setTimeout(r, ${POLL_INTERVAL_MS}));
      } while (Date.now() < deadline);
      spawn("open", [${JSON.stringify(url)}], { stdio: "ignore", detached: true }).unref();
    })();
  `;
    spawn(process.execPath, ["-e", script], { stdio: "ignore", detached: true }).unref();
}
// --wait-async hands the poll off to a detached child and returns immediately
// — the caller's terminal is free right away (see spawnWaitAndOpen above).
// --wait blocks this process until the URL responds (or times out).
// Either way, once we reach the bottom we're "ready": print the URL, or fork
// `open` and unref so the CLI returns immediately (browser launches async).
async function launch(url, opts) {
    const timeout = opts.timeout ?? DEFAULT_WAIT_TIMEOUT_SECONDS;
    if (opts.waitAsync) {
        header(`Waiting for ${url} in the background (up to ${timeout}s) — will open once it responds`);
        spawnWaitAndOpen(url, timeout);
        return;
    }
    if (opts.wait && !(await pollUntilReady(url, timeout))) {
        error(`Timed out after ${timeout}s waiting for ${url}`);
    }
    if (opts.print) {
        console.log(url);
        return;
    }
    header(`Opening ${url}`);
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}
export async function open(arg, opts = {}) {
    const cwd = opts.cwd ?? worktreeRoot() ?? process.cwd();
    const configRoot = opts.configRoot ?? resolveConfigRoot(cwd);
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
    const host = subdomain ? `${subdomain}.${wt.slug}.${config.tld}` : `${wt.slug}.${config.tld}`;
    await launch(`https://${host}`, {
        print: opts.print ?? false,
        wait: opts.wait,
        waitAsync: opts.waitAsync,
        timeout: opts.timeout,
    });
}
export async function projectOpen(arg, opts = {}) {
    const configRoot = opts.configRoot ?? resolveConfigRoot();
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
    await launch(`https://${host}`, {
        print: opts.print ?? false,
        wait: opts.wait,
        waitAsync: opts.waitAsync,
        timeout: opts.timeout,
    });
}
