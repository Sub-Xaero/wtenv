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

  // Quick DNS resolution test
  try {
    execSync("ping -c1 -W1 test-wsproxy-probe.test 2>&1", { stdio: "pipe" });
    check("DNS resolves *.test → 127.0.0.1", true);
  } catch (err: unknown) {
    const out = err instanceof Error ? err.message : String(err);
    const resolved = out.includes("127.0.0.1");
    check("DNS resolves *.test → 127.0.0.1", resolved);
  }

  const worktrees = listWorktrees();
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
