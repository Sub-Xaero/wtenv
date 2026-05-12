import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const DNSMASQ_CONF_DIR = "/opt/homebrew/etc/dnsmasq.d";

function confPath(name: string): string {
  return join(DNSMASQ_CONF_DIR, `${name}.conf`);
}

export function registerDnsmasq(worktreeName: string, tld: string): void {
  mkdirSync(DNSMASQ_CONF_DIR, { recursive: true });
  // local= prevents dnsmasq from forwarding to upstream — without it, dnsmasq
  // intermittently forwards queries instead of applying the address rule, causing
  // 30-second timeouts when upstream can't resolve .test domains.
  const domain = `${worktreeName}.${tld}`;
  const content = `local=/.${domain}/\naddress=/.${domain}/127.0.0.1\n`;
  writeFileSync(confPath(worktreeName), content);
  reloadDnsmasq();

  // If the TLD has a global resolver file (e.g. /etc/resolver/test written by setup),
  // subdomain queries already route to dnsmasq — nothing else to do.
  if (existsSync(`/etc/resolver/${tld}`)) return;

  // Otherwise write a per-worktree resolver file so subdomain queries route to dnsmasq.
  // This is the path .local TLDs take: we deliberately don't create /etc/resolver/local
  // globally because it would shadow Bonjour for every .local name on the machine.
  const resolverPath = `/etc/resolver/${domain}`;
  const resolverContent = "nameserver 127.0.0.1\nport 5300\noptions use-vc\n";
  const existing = existsSync(resolverPath) ? readFileSync(resolverPath, "utf8") : "";
  if (existing.trim() === resolverContent.trim()) return;

  const result = spawnSync(
    "sudo",
    ["bash", "-c", `mkdir -p /etc/resolver && printf 'nameserver 127.0.0.1\\nport 5300\\noptions use-vc\\n' > ${resolverPath}`],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    console.warn(`  Could not create ${resolverPath} — run manually:\n    sudo bash -c "printf 'nameserver 127.0.0.1\\\\nport 5300\\\\noptions use-vc\\\\n' > ${resolverPath}"`);
  } else {
    flushDnsCache();
  }
}

export function deregisterDnsmasq(worktreeName: string, tld?: string): void {
  const path = confPath(worktreeName);
  if (existsSync(path)) {
    unlinkSync(path);
    reloadDnsmasq();
  }

  // Remove per-worktree resolver file if we created one
  if (tld && !existsSync(`/etc/resolver/${tld}`)) {
    const resolverPath = `/etc/resolver/${worktreeName}.${tld}`;
    if (existsSync(resolverPath)) {
      spawnSync("sudo", ["rm", resolverPath], { stdio: "inherit" });
    }
  }
}

// Register static project domains (e.g. *.campfront.local).
// Only creates /etc/resolver/<baseDomain> when the TLD isn't already covered by a
// broader resolver file — creating a more-specific file when /etc/resolver/test already
// exists causes macOS to mis-route 2+ level deep subdomains (e.g. a.b.wavy.test) because
// macOS's resolver has a known bug with non-standard ports in specific-domain resolver files.
export function registerProjectDnsmasq(projectName: string, baseDomain: string): void {
  mkdirSync(DNSMASQ_CONF_DIR, { recursive: true });
  const content = `local=/.${baseDomain}/\naddress=/.${baseDomain}/127.0.0.1\n`;
  writeFileSync(confPath(`project-${projectName}`), content);
  reloadDnsmasq();

  const tld = baseDomain.split(".").pop() ?? baseDomain;
  const tldResolverPath = `/etc/resolver/${tld}`;
  if (existsSync(tldResolverPath)) {
    console.log(`  /etc/resolver/${baseDomain} skipped — covered by /etc/resolver/${tld}`);
    return;
  }

  const resolverPath = `/etc/resolver/${baseDomain}`;
  const resolverContent = "nameserver 127.0.0.1\nport 5300\noptions use-vc\n";
  const existing = existsSync(resolverPath) ? readFileSync(resolverPath, "utf8") : "";
  if (existing.trim() !== resolverContent.trim()) {
    const result = spawnSync(
      "sudo",
      ["bash", "-c", `mkdir -p /etc/resolver && printf 'nameserver 127.0.0.1\\nport 5300\\noptions use-vc\\n' > ${resolverPath}`],
      { stdio: "inherit" }
    );
    if (result.status !== 0) {
      console.warn(`  Could not create ${resolverPath} — run manually:\n    sudo bash -c "printf 'nameserver 127.0.0.1\\\\nport 5300\\\\noptions use-vc\\\\n' > ${resolverPath}"`);
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

  const tld = baseDomain.split(".").pop() ?? baseDomain;
  if (existsSync(`/etc/resolver/${tld}`)) return;

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
