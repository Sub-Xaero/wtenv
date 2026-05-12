import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const LAUNCH_AGENTS_DIR = join(process.env.HOME, "Library", "LaunchAgents");
const SCRIPTS_DIR = join(process.env.HOME, ".config", "wtenv");
function label(projectName) {
    return `wtenv.mdns.${projectName}`;
}
function plistPath(projectName) {
    return join(LAUNCH_AGENTS_DIR, `${label(projectName)}.plist`);
}
function scriptPath(projectName) {
    return join(SCRIPTS_DIR, `mdns-${projectName}.sh`);
}
// Publishes bare 2-label .local hostnames via mDNS so getaddrinfo() resolves them
// instantly. Using /etc/hosts alone forces a 5s mDNS timeout per query on macOS.
//
// We run one dns-sd process per hostname under a single LaunchAgent. dns-sd -P
// publishes both an SRV (under a private _wtenv._tcp type that won't appear in
// normal service browsers) and the corresponding A record for the host arg.
export function registerMdnsHosts(projectName, hostnames) {
    if (hostnames.length === 0)
        return;
    mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
    mkdirSync(SCRIPTS_DIR, { recursive: true });
    const script = scriptPath(projectName);
    const dnsSdCmds = hostnames
        .map((h, i) => `/usr/bin/dns-sd -P "wtenv-${projectName}-${i}" _wtenv._tcp local. 1 "${h}" 127.0.0.1 &`)
        .join("\n");
    writeFileSync(script, `#!/bin/bash
# Keep mDNS A-record publishers alive for project ${projectName}
trap 'kill 0' EXIT INT TERM
${dnsSdCmds}
wait
`, { mode: 0o755 });
    const plist = plistPath(projectName);
    writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label(projectName)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${script}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/${label(projectName)}.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/${label(projectName)}.log</string>
</dict>
</plist>
`);
    // Reload so changes take effect
    spawnSync("launchctl", ["unload", plist], { stdio: "ignore" });
    spawnSync("launchctl", ["load", plist], { stdio: "ignore" });
}
export function deregisterMdnsHosts(projectName) {
    const plist = plistPath(projectName);
    if (existsSync(plist)) {
        spawnSync("launchctl", ["unload", plist], { stdio: "ignore" });
        unlinkSync(plist);
    }
    const script = scriptPath(projectName);
    if (existsSync(script))
        unlinkSync(script);
}
// Collect hostnames that need mDNS publishing: bare 2-label .local names only.
// Multi-label .local (a.b.local) resolves through dnsmasq + /etc/resolver fine.
export function bareLocalHostnames(baseDomain, hostnames) {
    const isBareLocal = (h) => h.endsWith(".local") && h.split(".").length === 2;
    const all = [baseDomain, ...hostnames.filter((h) => !h.includes("*"))];
    return Array.from(new Set(all.filter(isBareLocal)));
}
