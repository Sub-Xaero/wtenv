#!/usr/bin/env node
import { Command } from "commander";
import { setup } from "./commands/setup.js";
import { teardown } from "./commands/teardown.js";
import { init } from "./commands/init.js";
import { register } from "./commands/register.js";
import { deregister, deregisterStale } from "./commands/deregister.js";
import { reregister } from "./commands/reregister.js";
import { reset } from "./commands/reset.js";
import { list } from "./commands/list.js";
import { ps } from "./commands/ps.js";
import { status } from "./commands/status.js";
import { doctor } from "./commands/doctor.js";
import { projectInit, projectRegister, projectDeregister } from "./commands/project.js";
import { open, projectOpen } from "./commands/open.js";
import { kill, projectKill } from "./commands/kill.js";
import { envExport, envUnset, envShow } from "./commands/env.js";
import { run } from "./commands/run.js";
import { listSlugs, renameSlug } from "./commands/slug.js";

const program = new Command();

program
  .name("wtenv")
  .description("Worktree environment manager for Conductor-managed git worktrees")
  .version("0.1.0");

program
  .command("run <command...>")
  .description("Run a command with the .env/.env.local/.env.worktree stack loaded")
  .option("--env-file <filename>", "Worktree env file name", ".env.worktree")
  .option("--cwd <path>", "Directory to read env files from and run in (default: current directory)")
  .allowUnknownOption(true)
  .action((command: string[], opts: { envFile: string; cwd?: string }) => {
    try {
      run(command, { envFile: opts.envFile, cwd: opts.cwd });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

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
  .option("--slug <slug>", "Use a specific DNS slug if available")
  .action(async (name: string | undefined, opts: { envFile: string; dryRun: boolean; slug?: string }) => {
    try {
      await register(name, { envFile: opts.envFile, dryRun: opts.dryRun, slug: opts.slug });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("list-slugs")
  .description("List bundled slugs and which ones are already taken")
  .option("--json", "Print machine-readable JSON")
  .action((opts: { json?: boolean }) => {
    try {
      listSlugs({ json: opts.json });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("rename-slug <slug>")
  .description("Rename the current worktree's DNS slug")
  .option("--env-file <filename>", "Env file name to update", ".env.worktree")
  .action(async (slug: string, opts: { envFile: string }) => {
    try {
      await renameSlug(slug, { envFile: opts.envFile });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("deregister [name]")
  .description("Remove DNS config, Caddy routes, and release port allocations")
  .option("--env-file <filename>", "Env file name to remove", ".env.worktree")
  .option("--slug <slug>", "Target a specific registered worktree by slug")
  .option("--stale", "Remove all orphaned registry entries whose worktree directory no longer exists")
  .action(async (name: string | undefined, opts: { envFile: string; slug?: string; stale?: boolean }) => {
    try {
      if (opts.stale) {
        await deregisterStale({ envFile: opts.envFile });
      } else {
        await deregister(name, { envFile: opts.envFile, slug: opts.slug });
      }
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
  .option("--json", "Print machine-readable JSON")
  .action(async (opts: { json?: boolean }) => {
    try {
      await list({ json: opts.json });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("ps")
  .description("Show which registered worktrees have active processes")
  .action(async () => {
    try {
      await ps();
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
  .option("--json", "Print machine-readable JSON")
  .action(async (opts: { json?: boolean }) => {
    try {
      await status({ json: opts.json });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program
  .command("doctor")
  .description("Check health of the full wtenv setup: services, config, and registry")
  .action(async () => {
    try {
      const anyFailed = await doctor();
      if (anyFailed) process.exit(1);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

const envCmd = program
  .command("env")
  .description("Inspect and export the worktree env stack");

envCmd
  .command("export")
  .description("Print `export KEY=VALUE` for the .env/.env.local/.env.worktree stack — use: eval \"$(wtenv env export)\"")
  .option("--env-file <filename>", "Worktree env file name", ".env.worktree")
  .option("--cwd <path>", "Directory to read env files from (default: current directory)")
  .action((opts: { envFile: string; cwd?: string }) => {
    try {
      envExport({ envFile: opts.envFile, cwd: opts.cwd });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

envCmd
  .command("unset")
  .description("Print `unset KEY` for every var the stack defines — use: eval \"$(wtenv env unset)\"")
  .option("--env-file <filename>", "Worktree env file name", ".env.worktree")
  .option("--cwd <path>", "Directory to read env files from (default: current directory)")
  .action((opts: { envFile: string; cwd?: string }) => {
    try {
      envUnset({ envFile: opts.envFile, cwd: opts.cwd });
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

envCmd
  .command("show")
  .description("Show the merged env stack with the layer each value came from")
  .option("--env-file <filename>", "Worktree env file name", ".env.worktree")
  .option("--cwd <path>", "Directory to read env files from (default: current directory)")
  .option("--json", "Print machine-readable JSON")
  .action((opts: { envFile: string; cwd?: string; json?: boolean }) => {
    try {
      envShow({ envFile: opts.envFile, cwd: opts.cwd, json: opts.json });
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
