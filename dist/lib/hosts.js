import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { requireSudoOrSkip, sudoExec } from "./sudo.js";
const HOSTS_PATH = "/etc/hosts";
// Stable temp path so the sudoers fragment can whitelist the exact /bin/mv invocation.
const HOSTS_STAGING = "/var/tmp/wtenv-hosts";
function markers(projectName) {
    return [`# BEGIN wtenv:${projectName}`, `# END wtenv:${projectName}`];
}
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function readHosts() {
    return existsSync(HOSTS_PATH) ? readFileSync(HOSTS_PATH, "utf8") : "";
}
function stripBlock(content, projectName) {
    const [begin, end] = markers(projectName);
    const re = new RegExp(`\\n*${escapeRegex(begin)}[\\s\\S]*?${escapeRegex(end)}\\n?`, "g");
    return content.replace(re, "\n").replace(/\n{3,}/g, "\n\n");
}
// Atomic /etc/hosts write: stage as the unprivileged user, then sudo mv into place.
// This shape lets the sudoers fragment whitelist a single literal command:
//   /bin/mv /var/tmp/wtenv-hosts /etc/hosts
function writeHosts(content) {
    writeFileSync(HOSTS_STAGING, content, { mode: 0o644 });
    return sudoExec(["/bin/mv", HOSTS_STAGING, HOSTS_PATH]);
}
// macOS mDNSResponder intercepts bare 2-label .local queries (e.g. foo.local)
// before consulting /etc/resolver/<domain>, so resolver files only cover subdomains.
// Add an /etc/hosts entry so the bare name maps to 127.0.0.1.
export function registerHostsEntries(projectName, hostnames) {
    if (hostnames.length === 0)
        return;
    const [begin, end] = markers(projectName);
    const block = [begin, ...hostnames.map((h) => `127.0.0.1 ${h}`), end].join("\n");
    const current = readHosts();
    const stripped = stripBlock(current, projectName);
    const sep = stripped.endsWith("\n") || stripped === "" ? "" : "\n";
    const next = `${stripped}${sep}${block}\n`;
    if (next === current)
        return;
    if (!requireSudoOrSkip("/etc/hosts update"))
        return;
    console.log(`  Writing /etc/hosts entries for ${hostnames.join(", ")}...`);
    if (!writeHosts(next)) {
        console.warn(`  Could not update /etc/hosts — bare .local names will not resolve.`);
    }
}
export function deregisterHostsEntries(projectName) {
    const current = readHosts();
    const stripped = stripBlock(current, projectName);
    if (stripped === current)
        return;
    if (!requireSudoOrSkip("/etc/hosts cleanup"))
        return;
    console.log(`  Removing /etc/hosts entries...`);
    writeHosts(stripped);
}
// Collect hostnames that need /etc/hosts entries: bare 2-label .local names only.
// Multi-label .local (a.b.local) resolves through dnsmasq + /etc/resolver fine.
export function bareLocalHostnames(baseDomain, hostnames) {
    const isBareLocal = (h) => h.endsWith(".local") && h.split(".").length === 2;
    const all = [baseDomain, ...hostnames.filter((h) => !h.includes("*"))];
    return Array.from(new Set(all.filter(isBareLocal)));
}
