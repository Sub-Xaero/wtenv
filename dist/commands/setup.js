import { execSync, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
const RESOLVER_PATH = "/etc/resolver/test";
const DNSMASQ_CONF_DIR = "/opt/homebrew/etc/dnsmasq.d";
function run(cmd, label) {
    process.stdout.write(`  ${label}... `);
    try {
        execSync(cmd, { stdio: "pipe" });
        console.log("done");
        return true;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`failed\n    ${msg}`);
        return false;
    }
}
export async function setup() {
    console.log("wsproxy one-time setup\n");
    console.log("Note: some steps require sudo.\n");
    // 1. Check/install dnsmasq
    const dnsmasqInstalled = spawnSync("which", ["dnsmasq"], { stdio: "pipe" }).status === 0;
    if (!dnsmasqInstalled) {
        run("brew install dnsmasq", "Installing dnsmasq");
    }
    else {
        console.log("  dnsmasq already installed");
    }
    // 2. Ensure dnsmasq.d dir exists
    if (!existsSync(DNSMASQ_CONF_DIR)) {
        mkdirSync(DNSMASQ_CONF_DIR, { recursive: true });
        console.log(`  Created ${DNSMASQ_CONF_DIR}`);
    }
    // 3. Ensure dnsmasq includes conf.d
    const dnsmasqConf = "/opt/homebrew/etc/dnsmasq.conf";
    if (existsSync(dnsmasqConf)) {
        const content = execSync(`cat ${dnsmasqConf}`, { encoding: "utf8" });
        if (!content.includes("conf-dir")) {
            execSync(`echo "conf-dir=${DNSMASQ_CONF_DIR}" >> ${dnsmasqConf}`);
            console.log(`  Added conf-dir to dnsmasq.conf`);
        }
    }
    // 4. Start dnsmasq via brew services
    run("brew services start dnsmasq", "Starting dnsmasq");
    // 5. Create /etc/resolver/test (requires sudo)
    if (!existsSync(RESOLVER_PATH)) {
        console.log(`  Creating ${RESOLVER_PATH} (requires sudo)...`);
        const result = spawnSync("sudo", ["bash", "-c", `mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > ${RESOLVER_PATH}`], { stdio: "inherit" });
        if (result.status === 0) {
            console.log("  done");
        }
        else {
            console.log(`  failed — run manually:\n    sudo bash -c 'mkdir -p /etc/resolver && echo "nameserver 127.0.0.1" > ${RESOLVER_PATH}'`);
        }
    }
    else {
        console.log(`  ${RESOLVER_PATH} already exists`);
    }
    // 6. Check/install Caddy
    const caddyInstalled = spawnSync("which", ["caddy"], { stdio: "pipe" }).status === 0;
    if (!caddyInstalled) {
        run("brew install caddy", "Installing Caddy");
    }
    else {
        console.log("  Caddy already installed");
    }
    // 7. Start Caddy with admin API
    // Write a minimal Caddyfile that enables the admin API
    const caddyfileContent = `
{
  admin localhost:2019
}
`;
    const caddyfilePath = `${process.env.HOME}/.wsproxy/Caddyfile`;
    writeFileSync(caddyfilePath, caddyfileContent);
    const caddyRunning = spawnSync("pgrep", ["-x", "caddy"], { stdio: "pipe" }).status === 0;
    if (!caddyRunning) {
        run(`caddy start --config ${caddyfilePath}`, "Starting Caddy");
    }
    else {
        console.log("  Caddy already running");
    }
    // 8. Trust Caddy's local CA
    run("caddy trust", "Trusting Caddy local CA (may prompt for password)");
    console.log("\nSetup complete.");
    console.log("Verify with: ping -c1 anything.test — should resolve to 127.0.0.1");
}
