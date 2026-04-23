import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const DNSMASQ_CONF_DIR = "/opt/homebrew/etc/dnsmasq.d";

function confPath(worktreeName: string): string {
  return join(DNSMASQ_CONF_DIR, `${worktreeName}.conf`);
}

export function registerDnsmasq(worktreeName: string, tld: string): void {
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

export function isDnsmasqRunning(): boolean {
  try {
    execSync("pgrep -x dnsmasq", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function reloadDnsmasq(): void {
  try {
    execSync("pkill -HUP dnsmasq", { stdio: "ignore" });
  } catch {
    // dnsmasq not running — not fatal, it will pick up the config on next start
  }
}
