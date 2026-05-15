import { spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { listWorktrees } from "../lib/registry.js";
import { deregister } from "./deregister.js";
import { promptYN } from "../lib/prompt.js";
import { primeSudoCache, sudoExec } from "../lib/sudo.js";
const RESOLVER_PATH_TEST = "/etc/resolver/test";
const SUDOERS_FRAGMENT_PATH = "/etc/sudoers.d/wtenv";
const CADDY_DAEMON_PLIST = "/Library/LaunchDaemons/wtenv.caddy.plist";
const CADDY_PID_FILE = "/tmp/wtenv-caddy.pid";
export async function teardown() {
    console.log("wtenv teardown\n");
    console.log("This will undo `wtenv setup`. You'll be asked about each component;");
    console.log("system packages (brew dnsmasq, brew caddy) are left in place unless");
    console.log("you explicitly opt in at the end.\n");
    const sudoRefresh = primeSudoCache();
    try {
        await tearDownWorktrees();
        await tearDownCaddy();
        await tearDownDnsmasq();
        await tearDownSudoers();
        await tearDownBrewPackages();
    }
    finally {
        if (sudoRefresh)
            clearInterval(sudoRefresh);
    }
    console.log("\nTeardown complete.");
}
async function tearDownWorktrees() {
    const worktrees = listWorktrees();
    if (worktrees.length === 0)
        return;
    console.log(`Active worktrees: ${worktrees.map((w) => w.name).join(", ")}`);
    if (!(await promptYN(`Deregister all ${worktrees.length} worktree(s)?`))) {
        console.log("  Skipped — worktrees remain registered.\n");
        return;
    }
    for (const wt of worktrees) {
        try {
            await deregister(wt.name, { cwd: wt.project_root });
        }
        catch (err) {
            console.error(`  Failed to deregister '${wt.name}': ${err instanceof Error ? err.message : err}`);
        }
    }
    console.log();
}
async function tearDownCaddy() {
    if (!(await promptYN("Remove Caddy daemon, restore agent, stored config, and untrust the local CA?"))) {
        console.log("  Skipped.\n");
        return;
    }
    // Untrust the local Caddy CA so it's removed from the system keychain.
    const caddyPresent = spawnSync("which", ["caddy"], { stdio: "pipe" }).status === 0;
    if (caddyPresent) {
        console.log("  Running `caddy untrust`...");
        spawnSync("caddy", ["untrust"], { stdio: "inherit", timeout: 30_000 });
    }
    // Stop and remove the LaunchDaemon we installed.
    if (existsSync(CADDY_DAEMON_PLIST)) {
        console.log(`  Unloading ${CADDY_DAEMON_PLIST}...`);
        spawnSync("sudo", ["-n", "launchctl", "unload", CADDY_DAEMON_PLIST], { stdio: "inherit" });
        sudoExec(["/bin/rm", "-f", CADDY_DAEMON_PLIST]);
    }
    // Clean up the PID file Caddy may have left behind.
    if (existsSync(CADDY_PID_FILE))
        sudoExec(["/bin/rm", "-f", CADDY_PID_FILE]);
    // Restore agent + scripts live in the user's home.
    const restorePlist = join(process.env.HOME, "Library", "LaunchAgents", "wtenv.caddy-restore.plist");
    if (existsSync(restorePlist)) {
        spawnSync("launchctl", ["unload", restorePlist], { stdio: "ignore" });
        unlinkSync(restorePlist);
        console.log(`  Removed ${restorePlist}`);
    }
    const configDir = join(process.env.HOME, ".config", "wtenv");
    for (const f of ["caddy-restore.sh", "caddy.json"]) {
        const p = join(configDir, f);
        if (existsSync(p)) {
            unlinkSync(p);
            console.log(`  Removed ${p}`);
        }
    }
    console.log();
}
async function tearDownDnsmasq() {
    if (!(await promptYN("Remove /etc/resolver/test and stop the dnsmasq user service?"))) {
        console.log("  Skipped.\n");
        return;
    }
    if (existsSync(RESOLVER_PATH_TEST)) {
        if (sudoExec(["/bin/rm", "-f", RESOLVER_PATH_TEST])) {
            console.log(`  Removed ${RESOLVER_PATH_TEST}`);
        }
    }
    // Stop the user-level dnsmasq service. We don't touch dnsmasq.conf — users may
    // have unrelated edits, and our additions (conf-dir, port=5300) are harmless.
    const userRunning = spawnSync("brew", ["services", "list"], { stdio: "pipe" })
        .stdout.toString().match(/dnsmasq\s+started/) !== null;
    if (userRunning) {
        console.log("  Stopping dnsmasq user service...");
        spawnSync("brew", ["services", "stop", "dnsmasq"], { stdio: "inherit", timeout: 10_000 });
    }
    // Flush DNS cache so the just-removed resolver file stops being consulted.
    sudoExec(["/usr/bin/dscacheutil", "-flushcache"], { stdio: "ignore" });
    sudoExec(["/usr/bin/killall", "-HUP", "mDNSResponder"], { stdio: "ignore" });
    console.log();
}
async function tearDownSudoers() {
    if (!existsSync(SUDOERS_FRAGMENT_PATH))
        return;
    if (!(await promptYN(`Remove ${SUDOERS_FRAGMENT_PATH} sudoers fragment?`))) {
        console.log("  Skipped — passwordless sudo for wtenv remains in place.\n");
        return;
    }
    if (sudoExec(["/bin/rm", "-f", SUDOERS_FRAGMENT_PATH])) {
        console.log(`  Removed ${SUDOERS_FRAGMENT_PATH}`);
    }
    else {
        console.warn(`  Failed to remove ${SUDOERS_FRAGMENT_PATH} — remove manually with:`);
        console.warn(`    sudo rm ${SUDOERS_FRAGMENT_PATH}`);
    }
    console.log();
}
async function tearDownBrewPackages() {
    const hasCaddy = spawnSync("which", ["caddy"], { stdio: "pipe" }).status === 0;
    const hasDnsmasq = spawnSync("which", ["dnsmasq"], { stdio: "pipe" }).status === 0;
    if (!hasCaddy && !hasDnsmasq)
        return;
    const packages = [hasCaddy && "caddy", hasDnsmasq && "dnsmasq"].filter(Boolean);
    if (!(await promptYN(`Uninstall brew packages (${packages.join(", ")})? They may be used by other tools.`))) {
        console.log("  Skipped — brew packages remain.\n");
        return;
    }
    spawnSync("brew", ["uninstall", ...packages], { stdio: "inherit", timeout: 60_000 });
    console.log();
}
