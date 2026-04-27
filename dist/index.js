#!/usr/bin/env node
import { Command } from "commander";
import { setup } from "./commands/setup.js";
import { register } from "./commands/register.js";
import { deregister } from "./commands/deregister.js";
import { list } from "./commands/list.js";
import { status } from "./commands/status.js";
import { projectRegister, projectDeregister } from "./commands/project.js";
const program = new Command();
program
    .name("wtenv")
    .description("Worktree environment manager for Conductor-managed git worktrees")
    .version("0.1.0");
program
    .command("setup")
    .description("One-time macOS setup: dnsmasq, /etc/resolver/test, Caddy CA trust")
    .action(async () => {
    try {
        await setup();
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
program
    .command("register [name]")
    .description("Allocate ports, configure DNS + proxy, write .env.worktree")
    .option("--env-file <filename>", "Env file name to write", ".env.worktree")
    .option("--dry-run", "Show what would be allocated without making changes")
    .action(async (name, opts) => {
    try {
        await register(name, { envFile: opts.envFile, dryRun: opts.dryRun });
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
program
    .command("deregister [name]")
    .description("Remove DNS config, Caddy routes, and release port allocations")
    .option("--env-file <filename>", "Env file name to remove", ".env.worktree")
    .action(async (name, opts) => {
    try {
        await deregister(name, { envFile: opts.envFile });
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
program
    .command("list")
    .description("List active worktrees with their ports and URLs")
    .action(async () => {
    try {
        await list();
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
program
    .command("status")
    .description("Check dnsmasq and Caddy health")
    .action(async () => {
    try {
        await status();
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
const projectCmd = program
    .command("project")
    .description("Manage static project domain registrations (non-worktree)");
projectCmd
    .command("register")
    .description("Register project domains from .wtenv.json project section")
    .option("--config-root <path>", "Directory containing .wtenv.json (default: git root)")
    .action(async (opts) => {
    try {
        await projectRegister({ configRoot: opts.configRoot });
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
projectCmd
    .command("deregister")
    .description("Remove project domain registrations")
    .option("--config-root <path>", "Directory containing .wtenv.json (default: git root)")
    .action(async (opts) => {
    try {
        await projectDeregister({ configRoot: opts.configRoot });
    }
    catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
});
program.parse();
