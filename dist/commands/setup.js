import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isCaddyRunning, setListener } from "../lib/caddy.js";
const RESOLVER_PATH = "/etc/resolver/test";
const DNSMASQ_CONF_DIR = "/opt/homebrew/etc/dnsmasq.d";
const DNSMASQ_CONF = "/opt/homebrew/etc/dnsmasq.conf";
function run(cmd, label, timeoutMs = 15_000) {
    process.stdout.write(`  ${label}... `);
    try {
        execSync(cmd, { stdio: "pipe", timeout: timeoutMs });
        console.log("done");
        return true;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`failed\n    ${msg}`);
        return false;
    }
}
function isProcessRunning(name) {
    return spawnSync("pgrep", ["-x", name], { stdio: "pipe" }).status === 0;
}
function isDnsmasqServingPort53() {
    // Check if anything is listening on UDP port 53
    try {
        execSync("lsof -i UDP:53 -sTCP:LISTEN 2>/dev/null | grep -q dnsmasq", { stdio: "pipe" });
        return true;
    }
    catch {
        // Try a DNS query to 127.0.0.1 port 53
        try {
            execSync("dig +time=1 +tries=1 @127.0.0.1 test.test >/dev/null 2>&1", { stdio: "pipe", timeout: 2000 });
            return true;
        }
        catch {
            return false;
        }
    }
}
export async function setup() {
    console.log("wtenv one-time setup\n");
    // --- dnsmasq ---
    const dnsmasqInstalled = spawnSync("which", ["dnsmasq"], { stdio: "pipe" }).status === 0;
    if (!dnsmasqInstalled) {
        run("brew install dnsmasq", "Installing dnsmasq", 120_000);
    }
    else {
        console.log("  dnsmasq already installed");
    }
    // Ensure dnsmasq.d dir exists and is included in config
    mkdirSync(DNSMASQ_CONF_DIR, { recursive: true });
    if (existsSync(DNSMASQ_CONF)) {
        let content = readFileSync(DNSMASQ_CONF, "utf8");
        const activeConfDir = content.split("\n").some((line) => !line.trimStart().startsWith("#") && line.includes("conf-dir") && line.includes(DNSMASQ_CONF_DIR));
        if (!activeConfDir) {
            content += `\nconf-dir=${DNSMASQ_CONF_DIR}/,*.conf\n`;
            console.log("  Added conf-dir to dnsmasq.conf");
        }
        // Run on non-privileged port 5300 so dnsmasq can run as a user service.
        // Port 5353 is owned by mDNSResponder on all interfaces — it will block dnsmasq.
        const hasPort = content.split("\n").some((line) => !line.trimStart().startsWith("#") && line.trim() === "port=5300");
        if (!hasPort) {
            // Migrate from old port=5353 if present
            content = content.replace(/^\s*port=5353\s*$/m, "");
            content += `\nport=5300\nlisten-address=127.0.0.1\nbind-interfaces\n`;
            console.log("  Configured dnsmasq to listen on 127.0.0.1:5300");
        }
        writeFileSync(DNSMASQ_CONF, content);
    }
    // Stop root-level service if running, then start as user service
    const dnsmasqAsRoot = spawnSync("sudo", ["brew", "services", "list"], { stdio: "pipe" })
        .stdout.toString().includes("dnsmasq") ?? false;
    if (dnsmasqAsRoot) {
        console.log("  Stopping root dnsmasq service (requires sudo)...");
        spawnSync("sudo", ["brew", "services", "stop", "dnsmasq"], { stdio: "inherit", timeout: 10_000 });
    }
    const dnsmasqUserRunning = spawnSync("brew", ["services", "list"], { stdio: "pipe" })
        .stdout.toString().match(/dnsmasq\s+started/) !== null;
    if (dnsmasqUserRunning) {
        console.log("  dnsmasq already running as user service");
    }
    else {
        run("brew services start dnsmasq", "Starting dnsmasq as user service");
    }
    // --- /etc/resolver/test ---
    // Tell macOS resolver to query dnsmasq directly on port 5300 (no pfctl redirect needed).
    // macOS pf rdr rules don't intercept locally-generated traffic, so port forwarding
    // 53→5300 doesn't work for system DNS queries.
    // use-vc forces TCP queries — dnsmasq has a macOS UDP socket bug where it stops
    // receiving after the first packet; TCP is reliable for multiple concurrent queries.
    const resolverContent = "nameserver 127.0.0.1\nport 5300\noptions use-vc\n";
    const existingResolver = existsSync(RESOLVER_PATH) ? readFileSync(RESOLVER_PATH, "utf8") : "";
    if (existingResolver.trim() !== resolverContent.trim()) {
        console.log("  Writing /etc/resolver/test (requires sudo)...");
        const result = spawnSync("sudo", ["bash", "-c", `mkdir -p /etc/resolver && printf 'nameserver 127.0.0.1\\nport 5300\\noptions use-vc\\n' > ${RESOLVER_PATH}`], { stdio: "inherit" });
        if (result.status !== 0) {
            console.log(`  failed — run manually:\n    sudo bash -c "printf 'nameserver 127.0.0.1\\\\nport 5300\\\\noptions use-vc\\\\n' > ${RESOLVER_PATH}"`);
        }
    }
    else {
        console.log(`  ${RESOLVER_PATH} already configured`);
    }
    // --- Caddy ---
    const caddyInstalled = spawnSync("which", ["caddy"], { stdio: "pipe" }).status === 0;
    if (!caddyInstalled) {
        run("brew install caddy", "Installing Caddy", 120_000);
    }
    else {
        console.log("  Caddy already installed");
    }
    // Write Caddy config to the brew location so brew services picks it up
    const caddyfileContent = `{\n  admin localhost:2019\n}\n`;
    const brewCaddyfile = "/opt/homebrew/etc/Caddyfile";
    if (!existsSync(brewCaddyfile) || !readFileSync(brewCaddyfile, "utf8").includes("admin localhost:2019")) {
        writeFileSync(brewCaddyfile, caddyfileContent);
        console.log("  Wrote Caddy config");
    }
    const caddyApiUp = await isCaddyRunning();
    if (caddyApiUp) {
        console.log("  Caddy already running");
    }
    else {
        // Needs root to bind :80 — use sudo brew services
        console.log("  Starting Caddy as system service (requires sudo)...");
        const result = spawnSync("sudo", ["brew", "services", "start", "caddy"], { stdio: "inherit", timeout: 15_000 });
        if (result.status !== 0) {
            console.log("  failed — run manually: sudo brew services start caddy");
        }
    }
    run("caddy trust", "Trusting Caddy local CA (may prompt for password)", 30_000);
    // Switch Caddy to HTTPS if port 443 is free (i.e. LocalCan has been quit)
    const port443InUse = spawnSync("lsof", ["-i", "TCP:443", "-sTCP:LISTEN"], { stdio: "pipe" }).stdout.toString().trim().length > 0;
    if (!port443InUse && await isCaddyRunning()) {
        try {
            await setListener([":443", ":80"]);
            console.log("  Caddy switched to HTTPS (:443 + :80)");
        }
        catch {
            console.log("  Could not switch Caddy to :443 (try again after quitting LocalCan)");
        }
    }
    else if (port443InUse) {
        console.log("\nNote: port 443 is in use (LocalCan?). Caddy stays on :80.");
        console.log("      Quit LocalCan and re-run 'wtenv setup' to enable HTTPS.");
    }
    // --- Caddy restore on login ---
    // Routes are stored in Caddy's memory and lost on restart. A LaunchAgent runs
    // a shell script on login that waits for Caddy then POSTs the saved config back.
    const configDir = join(process.env.HOME, ".config", "wtenv");
    mkdirSync(configDir, { recursive: true });
    const restoreScript = join(configDir, "caddy-restore.sh");
    const caddyJson = join(configDir, "caddy.json");
    writeFileSync(restoreScript, `#!/bin/bash
CONFIG="${caddyJson}"
for i in $(seq 1 30); do
  curl -sf http://localhost:2019/config/ > /dev/null 2>&1 && break
  sleep 1
done
[ -f "$CONFIG" ] && curl -sf -X POST http://localhost:2019/load \\
  -H "Content-Type: application/json" \\
  -d "@$CONFIG" > /dev/null 2>&1
`, { mode: 0o755 });
    const plistPath = join(process.env.HOME, "Library", "LaunchAgents", "wtenv.caddy-restore.plist");
    writeFileSync(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
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
  <key>StandardOutPath</key>
  <string>/tmp/wtenv-caddy-restore.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/wtenv-caddy-restore.log</string>
</dict>
</plist>
`);
    spawnSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
    spawnSync("launchctl", ["load", plistPath], { stdio: "ignore" });
    console.log("  Caddy restore agent installed");
    console.log("\nSetup complete.");
    console.log("Verify DNS: ping -c1 anything.test  — should resolve to 127.0.0.1");
}
