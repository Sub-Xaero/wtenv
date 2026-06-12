import { spawnSync } from "node:child_process";

export function listenersOn(port: number): number[] {
  const r = spawnSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const out = r.stdout?.toString().trim();
  if (!out) return [];
  return out.split("\n").filter(Boolean).map(Number);
}

export function processNames(pids: number[]): Map<number, string> {
  const names = new Map<number, string>();
  if (pids.length === 0) return names;
  const r = spawnSync("ps", ["-p", pids.join(","), "-o", "pid=,comm="], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  for (const line of (r.stdout?.toString().trim() ?? "").split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (m) names.set(Number(m[1]), m[2].trim().split("/").pop() ?? m[2].trim());
  }
  return names;
}
