import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const DNSMASQ_CONF_DIR = "/opt/homebrew/etc/dnsmasq.d";

function confPath(name: string): string {
  return join(DNSMASQ_CONF_DIR, `${name}.conf`);
}

export function registerDnsmasq(worktreeName: string, tld: string): void {
  mkdirSync(DNSMASQ_CONF_DIR, { recursive: true });
  const content = `address=/.${worktreeName}.${tld}/127.0.0.1\n`;
  writeFileSync(confPath(worktreeName), content);
  reloadDnsmasq();
}

export function deregisterDnsmasq(worktreeName: string): void {
  const path = confPath(worktreeName);
  if (existsSync(path)) {
    unlinkSync(path);
    reloadDnsmasq();
  }
}

// Register static project domains (e.g. *.campfront.local).
// Also creates /etc/resolver/<baseDomain> so macOS routes queries to dnsmasq
// instead of mDNS, keeping all other .local mDNS working.
export function registerProjectDnsmasq(projectName: string, baseDomain: string): void {
  mkdirSync(DNSMASQ_CONF_DIR, { recursive: true });
  const content = `address=/.${baseDomain}/127.0.0.1\n`;
  writeFileSync(confPath(`project-${projectName}`), content);
  reloadDnsmasq();

  const resolverPath = `/etc/resolver/${baseDomain}`;
  const resolverContent = "nameserver 127.0.0.1\nport 5300\n";
  const existing = existsSync(resolverPath) ? readFileSync(resolverPath, "utf8") : "";
  if (existing.trim() !== resolverContent.trim()) {
    const result = spawnSync(
      "sudo",
      ["bash", "-c", `mkdir -p /etc/resolver && printf 'nameserver 127.0.0.1\\nport 5300\\n' > ${resolverPath}`],
      { stdio: "inherit" }
    );
    if (result.status !== 0) {
      console.warn(`  Could not create ${resolverPath} — run manually:\n    sudo bash -c "printf 'nameserver 127.0.0.1\\\\nport 5300\\\\n' > ${resolverPath}"`);
    } else {
      flushDnsCache();
    }
  }
}

export function deregisterProjectDnsmasq(projectName: string, baseDomain: string): void {
  const path = confPath(`project-${projectName}`);
  if (existsSync(path)) {
    unlinkSync(path);
    reloadDnsmasq();
  }

  const resolverPath = `/etc/resolver/${baseDomain}`;
  if (existsSync(resolverPath)) {
    spawnSync("sudo", ["rm", resolverPath], { stdio: "inherit" });
  }
}

export function isDnsmasqRunning(): boolean {
  try {
    execSync("pgrep -x dnsmasq", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function flushDnsCache(): void {
  spawnSync("sudo", ["dscacheutil", "-flushcache"], { stdio: "ignore" });
  spawnSync("sudo", ["killall", "-HUP", "mDNSResponder"], { stdio: "ignore" });
}

function reloadDnsmasq(): void {
  // HUP only reloads the main conf, not conf-dir files — do a full restart via launchctl
  const plist = `${process.env.HOME}/Library/LaunchAgents/homebrew.mxcl.dnsmasq.plist`;
  const unload = spawnSync("launchctl", ["unload", plist], { stdio: "ignore" });
  if (unload.status === 0) {
    spawnSync("launchctl", ["load", plist], { stdio: "ignore" });
  } else {
    // Fall back to HUP if launchctl unload fails (e.g. not loaded yet)
    try {
      execSync("pkill -HUP dnsmasq", { stdio: "ignore" });
    } catch {
      // dnsmasq not running — not fatal, it will pick up config on next start
    }
  }
}
