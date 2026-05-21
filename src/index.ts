#!/usr/bin/env node
import { Command } from "commander";
import { setup } from "./commands/setup.js";
import { teardown } from "./commands/teardown.js";
import { init } from "./commands/init.js";
import { register } from "./commands/register.js";
import { deregister } from "./commands/deregister.js";
import { reregister } from "./commands/reregister.js";
import { reset } from "./commands/reset.js";
import { list } from "./commands/list.js";
import { status } from "./commands/status.js";
import { projectInit, projectRegister, projectDeregister } from "./commands/project.js";
import { open, projectOpen } from "./commands/open.js";
import { kill, projectKill } from "./commands/kill.js";

const program = new Command();

program
  .name("wtenv")
  .description("Worktree environment manager for Conductor-managed git worktrees")
  .version("0.1.0");

program
  .command("setup")
  .description("One-time macOS setup: dnsmasq, /etc/resolver/test, Caddy CA trust")
  .option("--install-sudoers", "Install /etc/sudoers.d/wtenv so register/deregister run without password prompts")
  .action(async (opts: { installSudoers?: boolean }) => {
    try {
      await setup({ installSudoers: opts.installSudoers });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("teardown")
  .description("Undo `wtenv setup`: remove Caddy daemon, dnsmasq config, /etc/resolver/test, sudoers fragment")
  .action(async () => {
    try {
      await teardown();
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("init")
  .description("Scaffold a .wtenv.config.js file with sensible defaults")
  .option("--force", "Overwrite an existing .wtenv.config.js")
  .option("--cwd <path>", "Directory to create the config in (default: current directory)")
  .action((opts: { force?: boolean; cwd?: string }) => {
    try {
      init(opts);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("register [name]")
  .description("Allocate ports, configure DNS + proxy, write .env.worktree")
  .option("--env-file <filename>", "Env file name to write", ".env.worktree")
  .option("--dry-run", "Show what would be allocated without making changes")
  .action(async (name: string | undefined, opts: { envFile: string; dryRun: boolean }) => {
    try {
      await register(name, { envFile: opts.envFile, dryRun: opts.dryRun });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("deregister [name]")
  .description("Remove DNS config, Caddy routes, and release port allocations")
  .option("--env-file <filename>", "Env file name to remove", ".env.worktree")
  .action(async (name: string | undefined, opts: { envFile: string }) => {
    try {
      await deregister(name, { envFile: opts.envFile });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("reregister [name]")
  .description("Deregister the current worktree (if registered) then register it again")
  .option("--env-file <filename>", "Env file name to write", ".env.worktree")
  .action(async (name: string | undefined, opts: { envFile: string }) => {
    try {
      await reregister(name, { envFile: opts.envFile });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("reset")
  .description("Deregister all currently registered worktrees")
  .action(async () => {
    try {
      await reset();
    } catch (err) {
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
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("open [arg]")
  .description("Open this worktree's domain (optionally with a subdomain or service name) in the default browser")
  .option("--print", "Print the URL instead of opening it")
  .action(async (arg: string | undefined, opts: { print?: boolean }) => {
    try {
      await open(arg, { print: opts.print });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("kill")
  .description("Terminate processes listening on this worktree's allocated ports")
  .option("-f, --force", "Send SIGKILL instead of SIGTERM")
  .option("--dry-run", "List matching processes without killing them")
  .action(async (opts: { force?: boolean; dryRun?: boolean }) => {
    try {
      await kill({ force: opts.force, dryRun: opts.dryRun });
    } catch (err) {
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
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const projectCmd = program
  .command("project")
  .description("Manage static project domain registrations (non-worktree)");

projectCmd
  .command("init")
  .description("Scaffold a .wtenv.config.js with a project block and example pipeline")
  .option("--force", "Overwrite an existing .wtenv.config.js")
  .option("--cwd <path>", "Directory to create the config in (default: current directory)")
  .action((opts: { force?: boolean; cwd?: string }) => {
    try {
      projectInit(opts);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

projectCmd
  .command("register")
  .description("Register project domains from .wtenv.json project section")
  .option("--config-root <path>", "Directory containing .wtenv.json (default: git root)")
  .action(async (opts: { configRoot?: string }) => {
    try {
      await projectRegister({ configRoot: opts.configRoot });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

projectCmd
  .command("open [arg]")
  .description("Open the configured project baseDomain (optionally with a subdomain) in the default browser")
  .option("--config-root <path>", "Directory containing .wtenv.config.js (default: git root)")
  .option("--print", "Print the URL instead of opening it")
  .action(async (arg: string | undefined, opts: { configRoot?: string; print?: boolean }) => {
    try {
      await projectOpen(arg, { configRoot: opts.configRoot, print: opts.print });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

projectCmd
  .command("kill")
  .description("Terminate processes listening on the configured project domain ports")
  .option("--config-root <path>", "Directory containing .wtenv.config.js (default: git root)")
  .option("-f, --force", "Send SIGKILL instead of SIGTERM")
  .option("--dry-run", "List matching processes without killing them")
  .action(async (opts: { configRoot?: string; force?: boolean; dryRun?: boolean }) => {
    try {
      await projectKill({ configRoot: opts.configRoot, force: opts.force, dryRun: opts.dryRun });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

projectCmd
  .command("deregister")
  .description("Remove project domain registrations")
  .option("--config-root <path>", "Directory containing .wtenv.json (default: git root)")
  .action(async (opts: { configRoot?: string }) => {
    try {
      await projectDeregister({ configRoot: opts.configRoot });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
