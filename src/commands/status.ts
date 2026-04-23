import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isDnsmasqRunning } from "../lib/dnsmasq.js";
import { isCaddyRunning } from "../lib/caddy.js";
import { listWorktrees } from "../lib/registry.js";

function check(label: string, ok: boolean, detail?: string): void {
  const icon = ok ? "✓" : "✗";
  const line = detail ? `${icon}  ${label}  (${detail})` : `${icon}  ${label}`;
  console.log(line);
}

export async function status(): Promise<void> {
  console.log("Infrastructure\n");

  check("dnsmasq running", isDnsmasqRunning());
  check("/etc/resolver/test exists", existsSync("/etc/resolver/test"));

  const caddyUp = await isCaddyRunning();
  check("Caddy running (admin :2019)", caddyUp);

  // DNS resolution test using a registered worktree if available
  const worktrees = listWorktrees();
  const probeWorktree = worktrees[0];
  if (probeWorktree) {
    const probeHost = `probe.${probeWorktree.name}.test`;
    try {
      const out = execSync(`dig +short @127.0.0.1 ${probeHost} 2>&1`, { encoding: "utf8", timeout: 3000 }).trim();
      check("DNS resolves *.test → 127.0.0.1", out === "127.0.0.1", out || "no answer from dnsmasq");
    } catch {
      check("DNS resolves *.test → 127.0.0.1", false, "dig failed — is dnsmasq on port 53?");
    }
  } else {
    check("DNS resolves *.test → 127.0.0.1", isDnsmasqRunning(), "no worktrees registered yet to probe");
  }

  console.log(`\nRegistered worktrees: ${worktrees.length}`);

  if (worktrees.length > 0) {
    for (const wt of worktrees) {
      const portSummary = Object.entries(wt.ports)
        .map(([s, p]) => `${s}:${p}`)
        .join("  ");
      console.log(`  ${wt.name.padEnd(24)} ${portSummary}`);
    }
  }
}
