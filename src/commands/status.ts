import { existsSync } from "node:fs";
import dns from "node:dns/promises";
import { isDnsmasqRunning } from "../lib/dnsmasq.js";
import { isCaddyRunning } from "../lib/caddy.js";
import { listWorktrees } from "../lib/registry.js";
import { header, step, info, c } from "../lib/log.js";

function check(label: string, ok: boolean, detail?: string): void {
  const icon = ok ? c.green("✓") : c.red("✗");
  const suffix = detail ? `  ${c.dim(`(${detail})`)}` : "";
  console.log(`    ${icon} ${label}${suffix}`);
}

interface StatusOptions {
  json?: boolean;
}

interface StatusCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export async function status(options: StatusOptions = {}): Promise<void> {
  const checks: StatusCheck[] = [];
  function record(label: string, ok: boolean, detail?: string): void {
    checks.push({ label, ok, detail });
  }

  record("dnsmasq running", isDnsmasqRunning());
  record("/etc/resolver/test exists", existsSync("/etc/resolver/test"));
  record("Caddy running (admin :2019)", await isCaddyRunning());

  const worktrees = listWorktrees();
  const probeWorktree = worktrees[0];
  if (probeWorktree) {
    const probeHost = `probe.${probeWorktree.slug}.test`;
    try {
      const { address } = await dns.lookup(probeHost);
      record("DNS resolves *.test → 127.0.0.1", address === "127.0.0.1", address);
    } catch {
      record("DNS resolves *.test → 127.0.0.1", false, "failed — run 'wtenv setup' to reconfigure");
    }
  } else {
    record("DNS resolves *.test → 127.0.0.1", isDnsmasqRunning(), "no worktrees registered yet to probe");
  }

  if (options.json) {
    console.log(JSON.stringify({ infrastructure: checks, worktrees }, null, 2));
    return;
  }

  header("wtenv status");
  console.log();

  step("infrastructure");
  for (const item of checks) check(item.label, item.ok, item.detail);
  console.log();

  step(`registered worktrees (${worktrees.length})`);
  if (worktrees.length === 0) {
    info("none");
  } else {
    for (const wt of worktrees) {
      const portSummary = Object.entries(wt.ports)
        .map(([s, p]) => `${s}:${p}`)
        .join("  ");
      const label = `${wt.name} (${wt.slug})`;
      info(`${label.padEnd(36)} ${portSummary}`);
    }
  }
}
