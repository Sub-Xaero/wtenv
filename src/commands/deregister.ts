import { loadConfig } from "../lib/config.js";
import { releasePorts, isRegistered } from "../lib/registry.js";
import { deregisterDnsmasq } from "../lib/dnsmasq.js";
import { deregisterCaddy } from "../lib/caddy.js";
import { teardownDatabase } from "../lib/database.js";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

interface DeregisterOptions {
  cwd?: string;
  configRoot?: string;
  envFile?: string;
}

export async function deregister(
  worktreeName: string,
  opts: DeregisterOptions = {}
): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const configRoot = opts.configRoot ?? cwd;

  if (!isRegistered(worktreeName)) {
    console.error(`Worktree '${worktreeName}' is not registered.`);
    process.exit(1);
  }

  const config = loadConfig(configRoot);

  deregisterDnsmasq(worktreeName);
  await deregisterCaddy(worktreeName);
  releasePorts(worktreeName);

  if (config.database) {
    teardownDatabase(worktreeName, config.database);
  }

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
