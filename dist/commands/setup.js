import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { isCaddyRunning } from "../lib/caddy.js";
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
    console.log("wsproxy one-time setup\n");
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
        const content = readFileSync(DNSMASQ_CONF, "utf8");
        if (!content.includes("conf-dir")) {
            execSync(`echo "conf-dir=${DNSMASQ_CONF_DIR}" >> ${DNSMASQ_CONF}`);
            console.log("  Added conf-dir to dnsmasq.conf");
        }
    }
    if (isDnsmasqServingPort53()) {
        console.log("  dnsmasq already serving port 53");
    }
    else {
        // dnsmasq needs root to bind port 53 — must use sudo brew services
        // First stop/remove any broken user-level LaunchAgent
        execSync("brew services stop dnsmasq 2>/dev/null || true", { stdio: "pipe" });
        console.log("  Starting dnsmasq as system service (requires sudo)...");
        const result = spawnSync("sudo", ["brew", "services", "start", "dnsmasq"], { stdio: "inherit", timeout: 15_000 });
        if (result.status === 0) {
            console.log("  done");
        }
        else {
            console.log("  failed — run manually: sudo brew services start dnsmasq");
        }
    }
    // --- /etc/resolver/test ---
    if (!existsSync(RESOLVER_PATH)) {
        console.log("  Creating /etc/resolver/test (requires sudo)...");
        const result = spawnSync("sudo", ["bash", "-c", `mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > ${RESOLVER_PATH}`], { stdio: "inherit" });
        if (result.status !== 0) {
            console.log(`  failed — run manually:\n    sudo bash -c 'mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > ${RESOLVER_PATH}'`);
        }
    }
    else {
        console.log(`  ${RESOLVER_PATH} already exists`);
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
    console.log("\nSetup complete.");
    console.log("Verify DNS: ping -c1 anything.test  — should resolve to 127.0.0.1");
}
