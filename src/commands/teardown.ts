import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { listWorktrees } from "../lib/registry.js";
import { deregister } from "./deregister.js";
import { promptYN } from "../lib/prompt.js";
import { primeSudoCache, sudoExec } from "../lib/sudo.js";
import { header, step, info, warn, success } from "../lib/log.js";

const RESOLVER_PATH_TEST = "/etc/resolver/test";
const SUDOERS_FRAGMENT_PATH = "/etc/sudoers.d/wtenv";
const CADDY_DAEMON_PLIST = "/Library/LaunchDaemons/wtenv.caddy.plist";
const CADDY_PID_FILE = "/tmp/wtenv-caddy.pid";

export async function teardown(): Promise<void> {
  header("Running wtenv teardown");
  console.log("    This will undo `wtenv setup`. You'll be asked about each component;");
  console.log("    system packages (brew dnsmasq, brew caddy) are left in place unless");
  console.log("    you explicitly opt in at the end.");
  console.log();

  const sudoRefresh = primeSudoCache();
  try {
    await tearDownWorktrees();
    await tearDownCaddy();
    await tearDownDnsmasq();
    await tearDownSudoers();
    await tearDownBrewPackages();
  } finally {
    if (sudoRefresh) clearInterval(sudoRefresh);
  }

  success("Teardown complete");
}

async function tearDownWorktrees(): Promise<void> {
  const worktrees = listWorktrees();
  if (worktrees.length === 0) return;

  step(`worktrees (${worktrees.length})`);
  info(`active: ${worktrees.map((w) => w.name).join(", ")}`);
  if (!(await promptYN(`    Deregister all ${worktrees.length} worktree(s)?`))) {
    info("skipped — worktrees remain registered");
    console.log();
    return;
  }
  for (const wt of worktrees) {
    try {
      await deregister(wt.name, { id: wt.id, cwd: wt.project_root });
    } catch (err) {
      warn(`failed to deregister '${wt.name}': ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log();
}

async function tearDownCaddy(): Promise<void> {
  step("caddy");
  if (!(await promptYN("    Remove Caddy daemon, restore agent, stored config, and untrust the local CA?"))) {
    info("skipped");
    console.log();
    return;
  }

  // Untrust the local Caddy CA so it's removed from the system keychain.
  const caddyPresent = spawnSync("which", ["caddy"], { stdio: "pipe" }).status === 0;
  if (caddyPresent) {
    info("running `caddy untrust`");
    spawnSync("caddy", ["untrust"], { stdio: "inherit", timeout: 30_000 });
  }

  // Stop and remove the LaunchDaemon we installed.
  if (existsSync(CADDY_DAEMON_PLIST)) {
    info(`unloading ${CADDY_DAEMON_PLIST}`);
    spawnSync("sudo", ["-n", "launchctl", "unload", CADDY_DAEMON_PLIST], { stdio: "inherit" });
    sudoExec(["/bin/rm", "-f", CADDY_DAEMON_PLIST]);
  }

  // Clean up the PID file Caddy may have left behind.
  if (existsSync(CADDY_PID_FILE)) sudoExec(["/bin/rm", "-f", CADDY_PID_FILE]);

  // Restore agent + scripts live in the user's home.
  const restorePlist = join(process.env.HOME!, "Library", "LaunchAgents", "wtenv.caddy-restore.plist");
  if (existsSync(restorePlist)) {
    spawnSync("launchctl", ["unload", restorePlist], { stdio: "ignore" });
    unlinkSync(restorePlist);
    info(`removed ${restorePlist}`);
  }

  const configDir = join(process.env.HOME!, ".config", "wtenv");
  for (const f of ["caddy-restore.sh", "caddy.json"]) {
    const p = join(configDir, f);
    if (existsSync(p)) {
      unlinkSync(p);
      info(`removed ${p}`);
    }
  }
  console.log();
}

async function tearDownDnsmasq(): Promise<void> {
  step("dnsmasq");
  if (!(await promptYN("    Remove /etc/resolver/test and stop the dnsmasq user service?"))) {
    info("skipped");
    console.log();
    return;
  }

  if (existsSync(RESOLVER_PATH_TEST)) {
    if (sudoExec(["/bin/rm", "-f", RESOLVER_PATH_TEST])) {
      info(`removed ${RESOLVER_PATH_TEST}`);
    }
  }

  // Stop the user-level dnsmasq service. We don't touch dnsmasq.conf — users may
  // have unrelated edits, and our additions (conf-dir, port=5300) are harmless.
  const userRunning = spawnSync("brew", ["services", "list"], { stdio: "pipe" })
    .stdout.toString().match(/dnsmasq\s+started/) !== null;
  if (userRunning) {
    info("stopping dnsmasq user service");
    spawnSync("brew", ["services", "stop", "dnsmasq"], { stdio: "inherit", timeout: 10_000 });
  }

  // Flush DNS cache so the just-removed resolver file stops being consulted.
  sudoExec(["/usr/bin/dscacheutil", "-flushcache"], { stdio: "ignore" });
  sudoExec(["/usr/bin/killall", "-HUP", "mDNSResponder"], { stdio: "ignore" });
  console.log();
}

async function tearDownSudoers(): Promise<void> {
  if (!existsSync(SUDOERS_FRAGMENT_PATH)) return;
  step("sudoers");
  if (!(await promptYN(`    Remove ${SUDOERS_FRAGMENT_PATH} sudoers fragment?`))) {
    info("skipped — passwordless sudo for wtenv remains in place");
    console.log();
    return;
  }
  if (sudoExec(["/bin/rm", "-f", SUDOERS_FRAGMENT_PATH])) {
    info(`removed ${SUDOERS_FRAGMENT_PATH}`);
  } else {
    warn(`failed to remove ${SUDOERS_FRAGMENT_PATH} — remove manually with: sudo rm ${SUDOERS_FRAGMENT_PATH}`);
  }
  console.log();
}

async function tearDownBrewPackages(): Promise<void> {
  const hasCaddy = spawnSync("which", ["caddy"], { stdio: "pipe" }).status === 0;
  const hasDnsmasq = spawnSync("which", ["dnsmasq"], { stdio: "pipe" }).status === 0;
  if (!hasCaddy && !hasDnsmasq) return;

  const packages = [hasCaddy && "caddy", hasDnsmasq && "dnsmasq"].filter(Boolean) as string[];
  step("brew packages");
  if (!(await promptYN(`    Uninstall brew packages (${packages.join(", ")})? They may be used by other tools.`))) {
    info("skipped — brew packages remain");
    console.log();
    return;
  }
  spawnSync("brew", ["uninstall", ...packages], { stdio: "inherit", timeout: 60_000 });
  console.log();
}
