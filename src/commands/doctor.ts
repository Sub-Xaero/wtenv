import { existsSync } from "node:fs";
import { join } from "node:path";
import dns from "node:dns/promises";
import { spawnSync } from "node:child_process";
import { isDnsmasqRunning } from "../lib/dnsmasq.js";
import { isCaddyRunning } from "../lib/caddy.js";
import { loadConfig } from "../lib/config.js";
import { listWorktrees } from "../lib/registry.js";
import { header, step, info, c, success, warn, error } from "../lib/log.js";

type Result = "pass" | "warn" | "fail";

function listeningPid(port: number): number | null {
  const result = spawnSync("lsof", ["-i", `:${port}`, "-sTCP:LISTEN", "-n", "-P", "-Fp"], {
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  const match = result.stdout.match(/^p(\d+)/m);
  return match ? parseInt(match[1], 10) : null;
}

function processCwd(pid: number): string | null {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const match = result.stdout.match(/^n(.+)$/m);
  return match ? match[1].trim() : null;
}

function printCheck(label: string, result: Result, detail?: string, fix?: string): void {
  const icon =
    result === "pass" ? c.green("✓") : result === "warn" ? c.yellow("⚠") : c.red("✗");
  const suffix = detail ? `  ${c.dim(`(${detail})`)}` : "";
  console.log(`    ${icon} ${label}${suffix}`);
  if (fix && result !== "pass") {
    console.log(`       ${c.dim("fix:")} ${fix}`);
  }
}

export async function doctor(): Promise<boolean> {
  let failCount = 0;
  let warnCount = 0;

  function check(label: string, result: Result, detail?: string, fix?: string): void {
    printCheck(label, result, detail, fix);
    if (result === "fail") failCount++;
    else if (result === "warn") warnCount++;
  }

  header("wtenv doctor");
  console.log();

  // ── Infrastructure ──────────────────────────────────────────────────────────
  step("infrastructure");

  check(
    "dnsmasq running",
    isDnsmasqRunning() ? "pass" : "fail",
    undefined,
    "run 'wtenv setup'"
  );

  check(
    "/etc/resolver/test exists",
    existsSync("/etc/resolver/test") ? "pass" : "fail",
    undefined,
    "run 'wtenv setup'"
  );

  const caddyUp = await isCaddyRunning();
  check(
    "Caddy running (admin :2019)",
    caddyUp ? "pass" : "fail",
    undefined,
    "run 'wtenv setup'"
  );

  const worktrees = listWorktrees();
  if (worktrees.length > 0) {
    const probeHost = `probe.${worktrees[0].slug}.test`;
    try {
      const { address } = await dns.lookup(probeHost);
      check(
        "DNS resolves *.test → 127.0.0.1",
        address === "127.0.0.1" ? "pass" : "fail",
        address,
        address !== "127.0.0.1" ? "run 'wtenv setup'" : undefined
      );
    } catch {
      check("DNS resolves *.test → 127.0.0.1", "fail", "lookup failed", "run 'wtenv setup'");
    }
  } else {
    check(
      "DNS resolves *.test → 127.0.0.1",
      isDnsmasqRunning() ? "pass" : "warn",
      "no worktrees registered to probe"
    );
  }

  const pg = spawnSync("pg_isready", { encoding: "utf8" });
  if (pg.error && (pg.error as NodeJS.ErrnoException).code === "ENOENT") {
    check("PostgreSQL reachable", "warn", "pg_isready not found — postgres may not be installed");
  } else if (pg.status === 0) {
    check("PostgreSQL reachable", "pass");
  } else {
    check(
      "PostgreSQL reachable",
      "warn",
      pg.stdout?.trim() || "not responding",
      "start PostgreSQL (e.g. 'brew services start postgresql@16')"
    );
  }

  const redis = spawnSync("redis-cli", ["PING"], { encoding: "utf8" });
  if (redis.error && (redis.error as NodeJS.ErrnoException).code === "ENOENT") {
    check("Redis reachable", "warn", "redis-cli not found — redis may not be installed");
  } else if (redis.status === 0 && redis.stdout?.trim() === "PONG") {
    check("Redis reachable", "pass");

    const dbCfg = spawnSync("redis-cli", ["CONFIG", "GET", "databases"], { encoding: "utf8" });
    if (dbCfg.status === 0) {
      const lines = dbCfg.stdout?.trim().split("\n") ?? [];
      const val = parseInt(lines[1], 10);
      if (!isNaN(val) && val <= 16) {
        check(
          "Redis databases config",
          "warn",
          `default (${val}) — too few for multiple worktrees`,
          "add 'databases 1024' to /opt/homebrew/etc/redis.conf and restart redis"
        );
      } else if (!isNaN(val)) {
        check("Redis databases config", "pass", String(val));
      }
    }
  } else {
    check(
      "Redis reachable",
      "warn",
      "not responding",
      "start Redis (e.g. 'brew services start redis')"
    );
  }
  console.log();

  // ── Config ───────────────────────────────────────────────────────────────────
  step("config");

  const configRoot = process.cwd();
  const jsConfigPath = join(configRoot, ".wtenv.config.js");
  const jsonConfigPath = join(configRoot, ".wtenv.json");

  if (existsSync(jsConfigPath)) {
    check("config file found", "pass", ".wtenv.config.js");
  } else if (existsSync(jsonConfigPath)) {
    check("config file found", "pass", ".wtenv.json");
  } else {
    check("config file found", "warn", "none — using defaults", "run 'wtenv init' to scaffold a config");
  }

  try {
    const cfg = await loadConfig(configRoot);
    check("config loads without errors", "pass");
    check(
      "at least one service defined",
      Object.keys(cfg.services).length > 0 ? "pass" : "warn",
      Object.keys(cfg.services).length > 0 ? Object.keys(cfg.services).join(", ") : undefined
    );
    check("tld is set", cfg.tld ? "pass" : "warn", cfg.tld || undefined);
  } catch (err_) {
    check(
      "config loads without errors",
      "fail",
      err_ instanceof Error ? err_.message : String(err_)
    );
  }
  console.log();

  // ── Registry ─────────────────────────────────────────────────────────────────
  step(`registry (${worktrees.length} ${worktrees.length === 1 ? "entry" : "entries"})`);

  if (worktrees.length === 0) {
    info("no worktrees registered");
  } else {
    for (const wt of worktrees) {
      const label = `${wt.name} (${wt.slug})`;

      const gitDirExists = existsSync(wt.id);
      check(
        `${label} — git-dir exists`,
        gitDirExists ? "pass" : "fail",
        gitDirExists ? undefined : wt.id,
        `run 'wtenv deregister --slug ${wt.slug}' or 'wtenv deregister --stale'`
      );

      const confFile = `/opt/homebrew/etc/dnsmasq.d/${wt.slug}.conf`;
      const confExists = existsSync(confFile);
      check(
        `${label} — dnsmasq conf present`,
        confExists ? "pass" : "fail",
        confExists ? undefined : confFile,
        `re-register with 'wtenv reregister' or cleanup with 'wtenv deregister --slug ${wt.slug}'`
      );

      for (const [service, port] of Object.entries(wt.ports)) {
        const pid = listeningPid(port);
        if (pid === null) continue;

        const cwd = processCwd(pid);
        const ownProcess =
          cwd !== null &&
          (cwd === wt.project_root || cwd.startsWith(wt.project_root + "/"));
        if (ownProcess) continue;

        check(
          `${label} — ${service} port ${port}`,
          "warn",
          cwd ? `in use by process running from ${cwd}` : "in use by unknown process"
        );
      }
    }
  }
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────────
  if (failCount === 0 && warnCount === 0) {
    success("All checks passed");
  } else if (failCount === 0) {
    warn(`${warnCount} warning${warnCount === 1 ? "" : "s"} — review the items above`);
  } else {
    error(
      `${failCount} failure${failCount === 1 ? "" : "s"}, ${warnCount} warning${warnCount === 1 ? "" : "s"} — see fix suggestions above`
    );
  }

  return failCount > 0;
}
