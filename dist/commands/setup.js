import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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
    const resolverContent = "nameserver 127.0.0.1\n";
    const existingResolver = existsSync(RESOLVER_PATH) ? readFileSync(RESOLVER_PATH, "utf8") : "";
    if (existingResolver.trim() !== resolverContent.trim()) {
        console.log("  Writing /etc/resolver/test (requires sudo)...");
        const result = spawnSync("sudo", ["bash", "-c", `mkdir -p /etc/resolver && printf '${resolverContent}' > ${RESOLVER_PATH}`], { stdio: "inherit" });
        if (result.status !== 0) {
            console.log(`  failed — run manually:\n    sudo bash -c "printf 'nameserver 127.0.0.1\\n' > ${RESOLVER_PATH}"`);
        }
    }
    else {
        console.log(`  ${RESOLVER_PATH} already configured`);
    }
    // --- pfctl: forward loopback port 53 → 5300 so dnsmasq runs without root ---
    const PF_ANCHOR_PATH = "/etc/pf.anchors/dev.dnsmasq";
    const pfRule = "rdr pass on lo0 proto udp from any to 127.0.0.1 port 53 -> 127.0.0.1 port 5300\n";
    const existingPfRule = existsSync(PF_ANCHOR_PATH) ? readFileSync(PF_ANCHOR_PATH, "utf8") : "";
    if (existingPfRule.trim() !== pfRule.trim()) {
        console.log("  Setting up pfctl DNS redirect (requires sudo)...");
        const pfResult = spawnSync("sudo", ["bash", "-c", `printf '${pfRule}' > ${PF_ANCHOR_PATH} && pfctl -ef ${PF_ANCHOR_PATH} 2>/dev/null; true`], { stdio: "inherit" });
        if (pfResult.status !== 0) {
            console.log(`  failed — run manually:\n    sudo bash -c "printf '${pfRule.trim()}\\n' > ${PF_ANCHOR_PATH} && pfctl -ef ${PF_ANCHOR_PATH}"`);
        }
    }
    else {
        // Reload in case pf rules were lost after reboot
        spawnSync("sudo", ["pfctl", "-ef", PF_ANCHOR_PATH], { stdio: "ignore" });
        console.log("  pfctl DNS redirect already configured");
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
    console.log("\nSetup complete.");
    console.log("Verify DNS: ping -c1 anything.test  — should resolve to 127.0.0.1");
}
