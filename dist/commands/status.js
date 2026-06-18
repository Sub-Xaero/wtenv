import { existsSync } from "node:fs";
import dns from "node:dns/promises";
import { isDnsmasqRunning } from "../lib/dnsmasq.js";
import { isCaddyRunning } from "../lib/caddy.js";
import { listWorktrees } from "../lib/registry.js";
import { header, step, info, c } from "../lib/log.js";
function check(label, ok, detail) {
    const icon = ok ? c.green("✓") : c.red("✗");
    const suffix = detail ? `  ${c.dim(`(${detail})`)}` : "";
    console.log(`    ${icon} ${label}${suffix}`);
}
export async function status() {
    header("wtenv status");
    console.log();
    step("infrastructure");
    check("dnsmasq running", isDnsmasqRunning());
    check("/etc/resolver/test exists", existsSync("/etc/resolver/test"));
    const caddyUp = await isCaddyRunning();
    check("Caddy running (admin :2019)", caddyUp);
    // DNS resolution test using a registered worktree if available
    const worktrees = listWorktrees();
    const probeWorktree = worktrees[0];
    if (probeWorktree) {
        const probeHost = `probe.${probeWorktree.slug}.test`;
        try {
            const { address } = await dns.lookup(probeHost);
            check("DNS resolves *.test → 127.0.0.1", address === "127.0.0.1", address);
        }
        catch {
            check("DNS resolves *.test → 127.0.0.1", false, "failed — run 'wtenv setup' to reconfigure");
        }
    }
    else {
        check("DNS resolves *.test → 127.0.0.1", isDnsmasqRunning(), "no worktrees registered yet to probe");
    }
    console.log();
    step(`registered worktrees (${worktrees.length})`);
    if (worktrees.length === 0) {
        info("none");
    }
    else {
        for (const wt of worktrees) {
            const portSummary = Object.entries(wt.ports)
                .map(([s, p]) => `${s}:${p}`)
                .join("  ");
            const label = `${wt.name} (${wt.slug})`;
            info(`${label.padEnd(36)} ${portSummary}`);
        }
    }
}
