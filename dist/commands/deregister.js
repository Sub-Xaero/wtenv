import { loadConfig } from "../lib/config.js";
import { releasePorts, isRegistered } from "../lib/registry.js";
import { deregisterDnsmasq } from "../lib/dnsmasq.js";
import { deregisterCaddy } from "../lib/caddy.js";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
export async function deregister(worktreeName, opts = {}) {
    const cwd = opts.cwd ?? process.cwd();
    if (!isRegistered(worktreeName)) {
        console.error(`Worktree '${worktreeName}' is not registered.`);
        process.exit(1);
    }
    const config = loadConfig(cwd);
    deregisterDnsmasq(worktreeName);
    await deregisterCaddy(worktreeName);
    releasePorts(worktreeName);
    // Clean up env file
    const envFilePath = join(cwd, opts.envFile ?? ".env.worktree");
    if (existsSync(envFilePath)) {
        unlinkSync(envFilePath);
    }
    console.log(`Deregistered worktree '${worktreeName}'`);
    console.log(`  Removed dnsmasq config for *.${worktreeName}.${config.tld}`);
    console.log(`  Removed Caddy routes`);
    console.log(`  Released port allocations`);
}
