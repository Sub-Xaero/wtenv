import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { isCaddyRunning, setListener } from "../lib/caddy.js";
import { promptYN } from "../lib/prompt.js";
import { primeSudoCache } from "../lib/sudo.js";
import { header, step, info, success, warn, c } from "../lib/log.js";

const RESOLVER_PATH = "/etc/resolver/test";
const DNSMASQ_CONF_DIR = "/opt/homebrew/etc/dnsmasq.d";
const DNSMASQ_CONF = "/opt/homebrew/etc/dnsmasq.conf";
const CADDY_DAEMON_PLIST = "/Library/LaunchDaemons/wtenv.caddy.plist";
const CADDY_PID_FILE = "/tmp/wtenv-caddy.pid";
const HOMEBREW_CADDY_PLIST = "/Library/LaunchDaemons/homebrew.mxcl.caddy.plist";

// Run a command silently with progress framing. Suppresses subprocess output
// so the user sees a clean "label... done/failed" line per setup substep —
// the verbose brew/caddy output is only relevant when something goes wrong.
function run(cmd: string, label: string, timeoutMs = 15_000): boolean {
  process.stdout.write(`    ${c.dim("→")} ${label}... `);
  try {
    execSync(cmd, { stdio: "pipe", timeout: timeoutMs });
    process.stdout.write("done\n");
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`failed\n      ${msg}\n`);
    return false;
  }
}

function isProcessRunning(name: string): boolean {
  return spawnSync("pgrep", ["-x", name], { stdio: "pipe" }).status === 0;
}

// PIDs of running `caddy run` processes that are NOT the wtenv daemon. Our daemon
// is the only one launched with --resume, so anything without it is a leftover
// (a brew service, or a manual `caddy run`) squatting on :443 or the :2019 admin.
function strayCaddyPids(): string[] {
  const out =
    spawnSync("bash", ["-c", "ps -axo pid=,command= | grep 'caddy run' | grep -v grep"], { stdio: "pipe" })
      .stdout?.toString() ?? "";
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.includes("--resume"))
    .map((line) => line.trim().split(/\s+/)[0]);
}

// Tear down any Caddy that conflicts with the wtenv daemon. Homebrew's caddy
// (from `brew services start caddy`) and wtenv's daemon both bind :443 and the
// :2019 admin; when both run, launchd splits the ports between them and wtenv's
// admin writes land on the instance that isn't serving traffic — every worktree
// then returns an empty 200 (white page). Returns true if anything was removed,
// so the caller knows to restart the wtenv daemon and reclaim the freed ports.
function removeConflictingCaddy(): boolean {
  let changed = false;

  if (existsSync(HOMEBREW_CADDY_PLIST)) {
    info("removing conflicting Homebrew caddy daemon");
    // bootout stops it now; disable + rm stop it respawning on the next boot
    // (a plain `launchctl unload` leaves the plist, so launchd reloads it).
    spawnSync(
      "sudo",
      [
        "bash",
        "-c",
        `launchctl bootout system/homebrew.mxcl.caddy 2>/dev/null; ` +
          `launchctl disable system/homebrew.mxcl.caddy 2>/dev/null; ` +
          `rm -f '${HOMEBREW_CADDY_PLIST}'`,
      ],
      { stdio: "pipe", timeout: 15_000 }
    );
    changed = true;
  }

  // A user-level `brew services` caddy (no-op if absent / already stopped).
  spawnSync("brew", ["services", "stop", "caddy"], { stdio: "pipe", timeout: 15_000 });

  // Kill any stray instance still holding ports after the daemon teardown.
  const strays = strayCaddyPids();
  if (strays.length > 0) {
    info(`stopping ${strays.length} stray caddy process(es): ${strays.join(", ")}`);
    spawnSync("sudo", ["kill", ...strays], { stdio: "pipe" });
    changed = true;
  }

  return changed;
}

function isDnsmasqServingPort53(): boolean {
  // Check if anything is listening on UDP port 53
  try {
    execSync("lsof -i UDP:53 -sTCP:LISTEN 2>/dev/null | grep -q dnsmasq", { stdio: "pipe" });
    return true;
  } catch {
    // Try a DNS query to 127.0.0.1 port 53
    try {
      execSync("dig +time=1 +tries=1 @127.0.0.1 test.test >/dev/null 2>&1", { stdio: "pipe", timeout: 2000 });
      return true;
    } catch {
      return false;
    }
  }
}

const SUDOERS_FRAGMENT_PATH = "/etc/sudoers.d/wtenv";
const SUDOERS_STAGING = "/var/tmp/wtenv-sudoers";

function buildSudoersFragment(username: string): string {
  // Whitelists the exact commands wtenv invokes during register/deregister so
  // headless runs don't trigger password prompts. Domain inputs are validated
  // in wtenv before reaching sudo, defending the /etc/resolver/* wildcards.
  return `# Installed by \`wtenv setup --install-sudoers\`. Do not edit by hand.
Cmnd_Alias WTENV_HOSTS    = /bin/mv /var/tmp/wtenv-hosts /etc/hosts
Cmnd_Alias WTENV_RESOLVER = /bin/mkdir -p /etc/resolver, \\
                            /bin/mv /var/tmp/wtenv-resolver-* /etc/resolver/*, \\
                            /bin/rm -f /etc/resolver/*
Cmnd_Alias WTENV_DNS      = /usr/bin/dscacheutil -flushcache, \\
                            /usr/bin/killall -HUP mDNSResponder

${username} ALL=(root) NOPASSWD: WTENV_HOSTS, WTENV_RESOLVER, WTENV_DNS
`;
}

export async function installSudoers(): Promise<void> {
  const username = userInfo().username;
  const fragment = buildSudoersFragment(username);

  header(`Installing sudoers fragment for ${username}`);
  console.log(`    ${c.dim("target:")} ${SUDOERS_FRAGMENT_PATH}`);
  console.log();

  writeFileSync(SUDOERS_STAGING, fragment, { mode: 0o440 });

  // Validate first — visudo -c refuses to apply broken fragments.
  step("validate");
  info("running visudo -c against staged fragment");
  const check = spawnSync("sudo", ["/usr/sbin/visudo", "-c", "-f", SUDOERS_STAGING], { stdio: "inherit" });
  if (check.status !== 0) {
    throw new Error("sudoers fragment failed visudo validation — not installing");
  }
  console.log();

  // install(1) sets owner+group+mode atomically. This is the one-and-only sudo
  // prompt the user should see; everything after this runs passwordless.
  step("install");
  info("install -m 0440 -o root -g wheel (one sudo prompt)");
  const result = spawnSync(
    "sudo",
    ["/usr/bin/install", "-m", "0440", "-o", "root", "-g", "wheel", SUDOERS_STAGING, SUDOERS_FRAGMENT_PATH],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new Error(`install failed (exit ${result.status})`);
  }
  console.log();

  success("Sudoers fragment installed");
  console.log(`    ${c.dim("verify:")}   sudo cat ${SUDOERS_FRAGMENT_PATH}`);
  console.log(`    ${c.dim("effect:")}   wtenv register/deregister will now run without password prompts`);
}

export interface SetupOptions {
  installSudoers?: boolean;
}

export async function setup(opts: SetupOptions = {}): Promise<void> {
  if (opts.installSudoers) {
    await installSudoers();
    return;
  }
  header("Running wtenv setup");
  console.log();

  // Offer the sudoers fragment up front. Installing it both primes the sudo
  // cache and lets the whitelisted register/deregister commands run NOPASSWD
  // for the remainder of setup (and forever after).
  if (!existsSync(SUDOERS_FRAGMENT_PATH)) {
    step("sudoers (optional)");
    console.log("    Install a sudoers fragment so wtenv register/deregister run without");
    console.log("    password prompts. Whitelists only the /etc/hosts and /etc/resolver");
    console.log("    edits wtenv needs — see `wtenv setup --install-sudoers` for the exact");
    console.log("    commands it whitelists.");
    console.log();
    if (await promptYN("    Install /etc/sudoers.d/wtenv?")) {
      try {
        await installSudoers();
      } catch (err) {
        warn(`sudoers install failed: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      info("skipped — install later with: wtenv setup --install-sudoers");
    }
    console.log();
  }

  const sudoRefresh = primeSudoCache();
  try {
    await runSetup();
  } finally {
    if (sudoRefresh) clearInterval(sudoRefresh);
  }
}

async function runSetup(): Promise<void> {

  // --- dnsmasq ---
  step("dnsmasq");

  const dnsmasqInstalled = spawnSync("which", ["dnsmasq"], { stdio: "pipe" }).status === 0;
  if (!dnsmasqInstalled) {
    run("brew install dnsmasq", "installing dnsmasq", 120_000);
  } else {
    info("dnsmasq already installed");
  }

  // Ensure dnsmasq.d dir exists and is included in config
  mkdirSync(DNSMASQ_CONF_DIR, { recursive: true });
  if (existsSync(DNSMASQ_CONF)) {
    let content = readFileSync(DNSMASQ_CONF, "utf8");

    const activeConfDir = content.split("\n").some(
      (line) => !line.trimStart().startsWith("#") && line.includes("conf-dir") && line.includes(DNSMASQ_CONF_DIR)
    );
    if (!activeConfDir) {
      content += `\nconf-dir=${DNSMASQ_CONF_DIR}/,*.conf\n`;
      info("added conf-dir to dnsmasq.conf");
    }

    // Run on non-privileged port 5300 so dnsmasq can run as a user service.
    // Port 5353 is owned by mDNSResponder on all interfaces — it will block dnsmasq.
    const hasPort = content.split("\n").some(
      (line) => !line.trimStart().startsWith("#") && line.trim() === "port=5300"
    );
    if (!hasPort) {
      // Migrate from old port=5353 if present
      content = content.replace(/^\s*port=5353\s*$/m, "");
      content += `\nport=5300\nlisten-address=127.0.0.1\nbind-interfaces\n`;
      info("configured dnsmasq to listen on 127.0.0.1:5300");
    }

    writeFileSync(DNSMASQ_CONF, content);
  }

  // Stop root-level service if running, then start as user service
  const dnsmasqAsRoot = spawnSync("sudo", ["brew", "services", "list"], { stdio: "pipe" })
    .stdout.toString().includes("dnsmasq") ?? false;
  if (dnsmasqAsRoot) {
    run("sudo brew services stop dnsmasq", "stopping root dnsmasq service", 10_000);
  }

  const dnsmasqUserRunning = spawnSync("brew", ["services", "list"], { stdio: "pipe" })
    .stdout.toString().match(/dnsmasq\s+started/) !== null;
  if (dnsmasqUserRunning) {
    info("dnsmasq already running as user service");
  } else {
    run("brew services start dnsmasq", "starting dnsmasq as user service");
  }
  console.log();

  // --- /etc/resolver/test ---
  // Tell macOS resolver to query dnsmasq directly on port 5300 (no pfctl redirect needed).
  // macOS pf rdr rules don't intercept locally-generated traffic, so port forwarding
  // 53→5300 doesn't work for system DNS queries.

  step("resolver");
  // use-vc forces TCP queries — dnsmasq has a macOS UDP socket bug where it stops
  // receiving after the first packet; TCP is reliable for multiple concurrent queries.
  const resolverContent = "nameserver 127.0.0.1\nport 5300\noptions use-vc\n";
  const existingResolver = existsSync(RESOLVER_PATH) ? readFileSync(RESOLVER_PATH, "utf8") : "";
  if (existingResolver.trim() !== resolverContent.trim()) {
    info(`writing ${RESOLVER_PATH} (one sudo prompt)`);
    const result = spawnSync(
      "sudo",
      ["bash", "-c", `mkdir -p /etc/resolver && printf 'nameserver 127.0.0.1\\nport 5300\\noptions use-vc\\n' > ${RESOLVER_PATH}`],
      { stdio: "inherit" }
    );
    if (result.status !== 0) {
      warn(`failed — run manually: sudo bash -c "printf 'nameserver 127.0.0.1\\nport 5300\\noptions use-vc\\n' > ${RESOLVER_PATH}"`);
    }
  } else {
    info(`${RESOLVER_PATH} already configured`);
  }

  // Flush mDNSResponder cache so the new resolver config is picked up immediately.
  // Without this, stale negative entries cause resolution failures until the cache expires.
  // Invoking the binaries directly (rather than via `bash -c`) keeps them covered by
  // the WTENV_DNS sudoers alias when the fragment is installed.
  info("flushing DNS cache");
  spawnSync("sudo", ["/usr/bin/dscacheutil", "-flushcache"], { stdio: "inherit" });
  spawnSync("sudo", ["/usr/bin/killall", "-HUP", "mDNSResponder"], { stdio: "inherit" });
  console.log();

  // --- Caddy ---
  step("caddy");

  const caddyInstalled = spawnSync("which", ["caddy"], { stdio: "pipe" }).status === 0;
  if (!caddyInstalled) {
    run("brew install caddy", "installing Caddy", 120_000);
  } else {
    info("Caddy already installed");
  }

  // Write Caddyfile (fallback config used on first boot before --resume has a saved state)
  const caddyfileContent = `{\n  admin localhost:2019\n}\n`;
  const brewCaddyfile = "/opt/homebrew/etc/Caddyfile";
  if (!existsSync(brewCaddyfile) || !readFileSync(brewCaddyfile, "utf8").includes("admin localhost:2019")) {
    writeFileSync(brewCaddyfile, caddyfileContent);
    info(`wrote ${brewCaddyfile}`);
  }

  // Use our own LaunchDaemon instead of brew's so we can pass --resume and --pidfile.
  // --resume: Caddy reloads its last-saved config on restart (no manual restore needed).
  // --pidfile: gives the restore agent a WatchPaths trigger for edge cases.
  const daemonPlistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>wtenv.caddy</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/opt/caddy/bin/caddy</string>
    <string>run</string>
    <string>--config</string>
    <string>/opt/homebrew/etc/Caddyfile</string>
    <string>--resume</string>
    <string>--pidfile</string>
    <string>${CADDY_PID_FILE}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>/opt/homebrew/var/lib</string>
    <key>XDG_DATA_HOME</key>
    <string>/opt/homebrew/var/lib</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/opt/homebrew/var/log/caddy.log</string>
  <key>StandardErrorPath</key>
  <string>/opt/homebrew/var/log/caddy.log</string>
</dict>
</plist>
`;

  // Remove a conflicting Homebrew caddy before judging whether ours is healthy:
  // isCaddyRunning() only proves *something* answers :2019, and that something may
  // be the brew instance — so this must run unconditionally, not gated behind the
  // "already running" check below.
  const conflictRemoved = removeConflictingCaddy();

  const daemonIsCurrent =
    existsSync(CADDY_DAEMON_PLIST) &&
    readFileSync(CADDY_DAEMON_PLIST, "utf8").includes("--resume");

  if (daemonIsCurrent && !conflictRemoved && (await isCaddyRunning())) {
    info("Caddy already running with wtenv daemon");
  } else {
    const tmpDaemon = "/tmp/wtenv-caddy-daemon.plist";
    writeFileSync(tmpDaemon, daemonPlistContent);

    // bootout + reload guarantees a fresh process that claims the now-free
    // :443/:80/:2019 — the running daemon may have lost the port race to brew.
    info("installing Caddy LaunchDaemon (one sudo prompt)");
    const result = spawnSync(
      "sudo",
      [
        "bash",
        "-c",
        `launchctl bootout system '${CADDY_DAEMON_PLIST}' 2>/dev/null; ` +
          `launchctl unload '${CADDY_DAEMON_PLIST}' 2>/dev/null; ` +
          `cp '${tmpDaemon}' '${CADDY_DAEMON_PLIST}' && launchctl load '${CADDY_DAEMON_PLIST}'`,
      ],
      { stdio: "inherit", timeout: 15_000 }
    );
    if (result.status !== 0) {
      warn(`failed — run manually: sudo cp ${tmpDaemon} ${CADDY_DAEMON_PLIST} && sudo launchctl load ${CADDY_DAEMON_PLIST}`);
    }
  }

  run("caddy trust", "trusting Caddy local CA (may prompt for password)", 30_000);

  // Switch Caddy to HTTPS if port 443 is free (i.e. LocalCan has been quit)
  const port443InUse = spawnSync("lsof", ["-i", "TCP:443", "-sTCP:LISTEN"], { stdio: "pipe" }).stdout.toString().trim().length > 0;
  if (!port443InUse && await isCaddyRunning()) {
    try {
      await setListener([":443", ":80"]);
      info("Caddy switched to HTTPS (:443 + :80)");
    } catch {
      warn("could not switch Caddy to :443 (try again after quitting LocalCan)");
    }
  } else if (port443InUse) {
    warn("port 443 is in use (LocalCan?). Caddy stays on :80. Quit LocalCan and re-run 'wtenv setup' to enable HTTPS.");
  }
  console.log();

  // --- Caddy restore agent (safety net) ---
  // Caddy's --resume handles config reload on restart automatically. This agent
  // is a fallback: it fires at login and whenever the PID file appears (Caddy restart),
  // then POSTs the saved config if the autosave is empty or stale.
  step("caddy-restore agent");
  const configDir = join(process.env.HOME!, ".config", "wtenv");
  mkdirSync(configDir, { recursive: true });

  const restoreScript = join(configDir, "caddy-restore.sh");
  const caddyJson = join(configDir, "caddy.json");
  writeFileSync(
    restoreScript,
    `#!/bin/bash
CONFIG="${caddyJson}"
for i in $(seq 1 30); do
  curl -sf http://localhost:2019/config/ > /dev/null 2>&1 && break
  sleep 1
done
[ -f "$CONFIG" ] && curl -sf -X POST http://localhost:2019/load \\
  -H "Content-Type: application/json" \\
  -d "@$CONFIG" > /dev/null 2>&1
`,
    { mode: 0o755 }
  );

  const plistPath = join(process.env.HOME!, "Library", "LaunchAgents", "wtenv.caddy-restore.plist");
  writeFileSync(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>wtenv.caddy-restore</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${restoreScript}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>WatchPaths</key>
  <array>
    <string>${CADDY_PID_FILE}</string>
  </array>
  <key>StandardOutPath</key>
  <string>/tmp/wtenv-caddy-restore.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/wtenv-caddy-restore.log</string>
</dict>
</plist>
`
  );

  spawnSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  spawnSync("launchctl", ["load", plistPath], { stdio: "ignore" });
  info(`installed LaunchAgent at ${plistPath}`);
  console.log();

  success("Setup complete");
  console.log(`    ${c.dim("verify DNS:")} ping -c1 anything.test  — should resolve to 127.0.0.1`);
}
