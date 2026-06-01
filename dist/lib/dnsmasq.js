import { writeFileSync, unlinkSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { requireSudoOrSkip, sudoExec } from "./sudo.js";
import { info, warn } from "./log.js";
const DNSMASQ_CONF_DIR = "/opt/homebrew/etc/dnsmasq.d";
// Domain-name regex used to defend the sudoers wildcards in /etc/resolver/*.
// Restrict to plain DNS labels; rejects path traversal and shell-meaningful chars.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
function confPath(name) {
    return join(DNSMASQ_CONF_DIR, `${name}.conf`);
}
function stagingPath(domain) {
    // Stable per-domain path so sudoers can whitelist `/bin/mv /var/tmp/wtenv-resolver-* /etc/resolver/*`.
    return `/var/tmp/wtenv-resolver-${domain}`;
}
// Write /etc/resolver/<domain> via stage-then-sudo-mv, so the only privileged
// commands are `/bin/mkdir -p /etc/resolver` and `/bin/mv /var/tmp/wtenv-resolver-* /etc/resolver/*`.
function installResolverFile(domain) {
    if (!DOMAIN_RE.test(domain)) {
        warn(`refusing to write /etc/resolver/${domain} — domain name failed validation`);
        return false;
    }
    const staging = stagingPath(domain);
    writeFileSync(staging, "nameserver 127.0.0.1\nport 5300\noptions use-vc\n", { mode: 0o644 });
    if (!sudoExec(["/bin/mkdir", "-p", "/etc/resolver"]))
        return false;
    return sudoExec(["/bin/mv", staging, `/etc/resolver/${domain}`]);
}
function removeResolverFile(domain) {
    if (!DOMAIN_RE.test(domain))
        return false;
    return sudoExec(["/bin/rm", "-f", `/etc/resolver/${domain}`]);
}
export function registerDnsmasq(worktreeName, tld) {
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
    if (existsSync(`/etc/resolver/${tld}`))
        return;
    // Otherwise write a per-worktree resolver file so subdomain queries route to dnsmasq.
    // This is the path .local TLDs take: we deliberately don't create /etc/resolver/local
    // globally because it would shadow Bonjour for every .local name on the machine.
    const resolverPath = `/etc/resolver/${domain}`;
    const expected = "nameserver 127.0.0.1\nport 5300\noptions use-vc\n";
    if (existsSync(resolverPath) && readFileSync(resolverPath, "utf8").trim() === expected.trim())
        return;
    if (!requireSudoOrSkip(`/etc/resolver/${domain} write`))
        return;
    if (installResolverFile(domain)) {
        flushDnsCache();
    }
    else {
        warn(`could not create /etc/resolver/${domain} — DNS for *.${domain} may not work`);
    }
}
export function deregisterDnsmasq(worktreeName, tld) {
    const path = confPath(worktreeName);
    if (existsSync(path)) {
        unlinkSync(path);
        reloadDnsmasq();
    }
    // Remove per-worktree resolver file if we created one
    if (tld && !existsSync(`/etc/resolver/${tld}`)) {
        const domain = `${worktreeName}.${tld}`;
        const resolverPath = `/etc/resolver/${domain}`;
        if (existsSync(resolverPath)) {
            if (!requireSudoOrSkip(`/etc/resolver/${domain} cleanup`))
                return;
            removeResolverFile(domain);
        }
    }
}
// Register static project domains (e.g. *.campfront.local).
// Only creates /etc/resolver/<baseDomain> when the TLD isn't already covered by a
// broader resolver file — creating a more-specific file when /etc/resolver/test already
// exists causes macOS to mis-route 2+ level deep subdomains (e.g. a.b.wavy.test) because
// macOS's resolver has a known bug with non-standard ports in specific-domain resolver files.
export function registerProjectDnsmasq(projectName, baseDomain) {
    mkdirSync(DNSMASQ_CONF_DIR, { recursive: true });
    const content = `local=/.${baseDomain}/\naddress=/.${baseDomain}/127.0.0.1\n`;
    writeFileSync(confPath(`project-${projectName}`), content);
    reloadDnsmasq();
    const tld = baseDomain.split(".").pop() ?? baseDomain;
    const tldResolverPath = `/etc/resolver/${tld}`;
    if (existsSync(tldResolverPath)) {
        info(`/etc/resolver/${baseDomain} skipped — covered by /etc/resolver/${tld}`);
        return;
    }
    const resolverPath = `/etc/resolver/${baseDomain}`;
    const expected = "nameserver 127.0.0.1\nport 5300\noptions use-vc\n";
    if (existsSync(resolverPath) && readFileSync(resolverPath, "utf8").trim() === expected.trim())
        return;
    if (!requireSudoOrSkip(`/etc/resolver/${baseDomain} write`))
        return;
    if (installResolverFile(baseDomain)) {
        flushDnsCache();
    }
    else {
        warn(`could not create /etc/resolver/${baseDomain} — DNS for *.${baseDomain} may not work`);
    }
}
export function deregisterProjectDnsmasq(projectName, baseDomain) {
    const path = confPath(`project-${projectName}`);
    if (existsSync(path)) {
        unlinkSync(path);
        reloadDnsmasq();
    }
    const tld = baseDomain.split(".").pop() ?? baseDomain;
    if (existsSync(`/etc/resolver/${tld}`))
        return;
    const resolverPath = `/etc/resolver/${baseDomain}`;
    if (existsSync(resolverPath)) {
        if (!requireSudoOrSkip(`/etc/resolver/${baseDomain} cleanup`))
            return;
        removeResolverFile(baseDomain);
    }
}
export function isDnsmasqRunning() {
    try {
        execSync("pgrep -x dnsmasq", { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
function flushDnsCache() {
    sudoExec(["/usr/bin/dscacheutil", "-flushcache"], { stdio: "ignore" });
    sudoExec(["/usr/bin/killall", "-HUP", "mDNSResponder"], { stdio: "ignore" });
}
function reloadDnsmasq() {
    // A fresh process is required to pick up conf-dir changes — HUP only reloads the
    // main conf, not the per-worktree files in dnsmasq.d. Use `kickstart -k`: it kills
    // the running instance and restarts it from the already-bootstrapped launchd job,
    // reliably leaving a live process. The legacy `launchctl unload` + `load` pair we
    // used before frequently left the job bootstrapped-but-never-spawned (runs=0),
    // silently killing DNS for every *.test name until someone kickstarted it by hand.
    const uid = process.getuid?.() ?? 0;
    const target = `gui/${uid}/homebrew.mxcl.dnsmasq`;
    const kick = spawnSync("launchctl", ["kickstart", "-k", target], { stdio: "ignore" });
    if (kick.status !== 0) {
        // Job isn't bootstrapped yet — load it so RunAtLoad spawns the process.
        const plist = `${process.env.HOME}/Library/LaunchAgents/homebrew.mxcl.dnsmasq.plist`;
        spawnSync("launchctl", ["bootstrap", `gui/${uid}`, plist], { stdio: "ignore" });
    }
    // The system resolver may have cached NXDOMAIN for names dnsmasq now answers
    // (e.g. when /etc/resolver/<tld> was already in place). Flush so the new config
    // takes effect immediately. Best-effort — sudoExec uses -n and skips silently.
    flushDnsCache();
}
