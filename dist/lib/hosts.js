import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const HOSTS_PATH = "/etc/hosts";
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
// Writes /etc/hosts atomically via sudo. Returns true on success.
function writeHosts(content) {
    const result = spawnSync("sudo", ["bash", "-c", `cat > /tmp/wtenv-hosts && mv /tmp/wtenv-hosts ${HOSTS_PATH}`], { input: content, stdio: ["pipe", "inherit", "inherit"] });
    return result.status === 0;
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
    console.log(`  Writing /etc/hosts entries for ${hostnames.join(", ")} (requires sudo)...`);
    if (!writeHosts(next)) {
        console.warn(`  Could not update /etc/hosts — bare .local names will not resolve.`);
    }
}
export function deregisterHostsEntries(projectName) {
    const current = readHosts();
    const stripped = stripBlock(current, projectName);
    if (stripped === current)
        return;
    console.log(`  Removing /etc/hosts entries (requires sudo)...`);
    writeHosts(stripped);
}
// Collect hostnames that need /etc/hosts entries: bare 2-label .local names only.
// Multi-label .local (a.b.local) resolves through dnsmasq + /etc/resolver fine.
export function bareLocalHostnames(baseDomain, hostnames) {
    const isBareLocal = (h) => h.endsWith(".local") && h.split(".").length === 2;
    const all = [baseDomain, ...hostnames.filter((h) => !h.includes("*"))];
    return Array.from(new Set(all.filter(isBareLocal)));
}
