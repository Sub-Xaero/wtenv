import * as http from "node:http";
import type { ProjectDomain } from "./config.js";

const CADDY_ADMIN_HOST = "localhost";
const CADDY_ADMIN_PORT = 2019;

interface CaddyRoute {
  match: Array<{ host: string[] }>;
  handle: Array<{ handler: string; upstreams: Array<{ dial: string }> }>;
}

interface CaddyConfig {
  apps?: {
    http?: {
      servers?: {
        wtenv?: {
          listen?: string[];
          routes?: CaddyRoute[];
        };
      };
    };
    tls?: {
      automation?: {
        policies?: Array<{ issuers: Array<{ module: string }> }>;
      };
    };
  };
}

function httpRequest(options: http.RequestOptions, body?: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getConfig(): Promise<CaddyConfig | null> {
  try {
    const { status, data } = await httpRequest({
      hostname: CADDY_ADMIN_HOST,
      port: CADDY_ADMIN_PORT,
      path: "/config/",
      method: "GET",
    });
    if (status !== 200) return null;
    return JSON.parse(data) as CaddyConfig;
  } catch {
    return null;
  }
}

async function patchRoutes(
  newRoutes: CaddyRoute[],
  filterFn: (route: CaddyRoute) => boolean
): Promise<void> {
  const existing = await getConfig();
  const currentServer = existing?.apps?.http?.servers?.wtenv;
  const currentRoutes: CaddyRoute[] = currentServer?.routes ?? [];
  // Preserve the existing listener config; fall back to :443 + :80 if no server yet
  const listen = currentServer?.listen ?? [":443", ":80"];
  const filtered = currentRoutes.filter(filterFn);

  const body = JSON.stringify({
    apps: {
      http: {
        servers: {
          wtenv: {
            listen,
            routes: [...filtered, ...newRoutes],
          },
        },
      },
      tls: {
        automation: {
          // Use Caddy's internal CA for all local dev domains — no ACME needed
          policies: [{ issuers: [{ module: "internal" }] }],
        },
      },
    },
  } satisfies CaddyConfig);

  const { status, data } = await httpRequest(
    {
      hostname: CADDY_ADMIN_HOST,
      port: CADDY_ADMIN_PORT,
      path: "/load",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    },
    body
  );
  if (status !== 200) throw new Error(`Caddy load failed (${status}): ${data}`);
}

function buildWorktreeRoutes(
  worktreeName: string,
  tld: string,
  ports: Record<string, number>,
  serviceHostnames: Record<string, string>
): CaddyRoute[] {
  const routes: CaddyRoute[] = [];
  const wildcardPort = Object.entries(serviceHostnames)
    .filter(([, h]) => h === "*")
    .map(([svc]) => ports[svc])[0];

  for (const [service, hostname] of Object.entries(serviceHostnames)) {
    if (hostname === "*") continue;
    const port = ports[service];
    if (port === undefined) continue;
    routes.push({
      match: [{ host: [`${hostname}.${worktreeName}.${tld}`] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `localhost:${port}` }] }],
    });
  }

  if (wildcardPort !== undefined) {
    routes.push({
      match: [{ host: [`*.${worktreeName}.${tld}`] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `localhost:${wildcardPort}` }] }],
    });
  }

  return routes;
}

function buildProjectRoutes(domains: ProjectDomain[]): CaddyRoute[] {
  // Sort: specific hostnames (no wildcard) first, wildcards last
  const sorted = [...domains].sort((a, b) => {
    const aWild = a.hostname.startsWith("*") ? 1 : 0;
    const bWild = b.hostname.startsWith("*") ? 1 : 0;
    return aWild - bWild;
  });

  return sorted.map((d) => ({
    match: [{ host: [d.hostname] }],
    handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `localhost:${d.port}` }] }],
  }));
}

export async function registerCaddy(
  worktreeName: string,
  tld: string,
  ports: Record<string, number>,
  serviceHostnames: Record<string, string>
): Promise<void> {
  const newRoutes = buildWorktreeRoutes(worktreeName, tld, ports, serviceHostnames);
  await patchRoutes(
    newRoutes,
    (r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`)))
  );
}

export async function deregisterCaddy(worktreeName: string): Promise<void> {
  await patchRoutes(
    [],
    (r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`)))
  );
}

export async function registerProjectCaddy(
  projectName: string,
  domains: ProjectDomain[]
): Promise<void> {
  const newRoutes = buildProjectRoutes(domains);
  await patchRoutes(
    newRoutes,
    (r) => !r.match.some((m) => m.host?.some((h) => isProjectRoute(h, projectName, domains)))
  );
}

export async function deregisterProjectCaddy(
  projectName: string,
  domains: ProjectDomain[]
): Promise<void> {
  await patchRoutes(
    [],
    (r) => !r.match.some((m) => m.host?.some((h) => isProjectRoute(h, projectName, domains)))
  );
}

function isProjectRoute(host: string, _projectName: string, domains: ProjectDomain[]): boolean {
  return domains.some((d) => d.hostname === host);
}

export async function setListener(ports: string[]): Promise<void> {
  const existing = await getConfig();
  const currentRoutes: CaddyRoute[] = existing?.apps?.http?.servers?.wtenv?.routes ?? [];
  const body = JSON.stringify({
    apps: {
      http: {
        servers: {
          wtenv: {
            listen: ports,
            routes: currentRoutes,
          },
        },
      },
      tls: {
        automation: {
          policies: [{ issuers: [{ module: "internal" }] }],
        },
      },
    },
  } satisfies CaddyConfig);

  const { status, data } = await httpRequest(
    {
      hostname: CADDY_ADMIN_HOST,
      port: CADDY_ADMIN_PORT,
      path: "/load",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    },
    body
  );
  if (status !== 200) throw new Error(`Caddy load failed (${status}): ${data}`);
}

export async function isCaddyRunning(): Promise<boolean> {
  try {
    const { status } = await httpRequest({
      hostname: CADDY_ADMIN_HOST,
      port: CADDY_ADMIN_PORT,
      path: "/config/",
      method: "GET",
    });
    return status === 200;
  } catch {
    return false;
  }
}
