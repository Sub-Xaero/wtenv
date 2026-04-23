const CADDY_ADMIN = "http://localhost:2019";

interface CaddyRoute {
  match: Array<{ host: string[] }>;
  handle: Array<{ handler: string; upstreams: Array<{ dial: string }> }>;
}

interface CaddyConfig {
  apps: {
    http: {
      servers: {
        wsproxy: {
          listen: string[];
          routes: CaddyRoute[];
        };
      };
    };
  };
}

async function getConfig(): Promise<CaddyConfig | null> {
  try {
    const res = await fetch(`${CADDY_ADMIN}/config/`);
    if (!res.ok) return null;
    return (await res.json()) as CaddyConfig;
  } catch {
    return null;
  }
}

async function loadConfig(config: CaddyConfig): Promise<void> {
  const res = await fetch(`${CADDY_ADMIN}/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Caddy load failed (${res.status}): ${body}`);
  }
}

function buildRoutes(
  worktreeName: string,
  tld: string,
  ports: Record<string, number>,
  serviceHostnames: Record<string, string>
): CaddyRoute[] {
  const routes: CaddyRoute[] = [];
  const wildcardPort: number | undefined = Object.entries(serviceHostnames)
    .filter(([, hostname]) => hostname === "*")
    .map(([service]) => ports[service])[0];

  // Specific-hostname routes first (higher priority in Caddy)
  for (const [service, hostname] of Object.entries(serviceHostnames)) {
    if (hostname === "*") continue;
    const port = ports[service];
    if (port === undefined) continue;
    routes.push({
      match: [{ host: [`${hostname}.${worktreeName}.${tld}`] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `localhost:${port}` }] }],
    });
  }

  // Wildcard route last
  if (wildcardPort !== undefined) {
    routes.push({
      match: [{ host: [`*.${worktreeName}.${tld}`] }],
      handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `localhost:${wildcardPort}` }] }],
    });
  }

  return routes;
}

export async function registerCaddy(
  worktreeName: string,
  tld: string,
  ports: Record<string, number>,
  serviceHostnames: Record<string, string>
): Promise<void> {
  const newRoutes = buildRoutes(worktreeName, tld, ports, serviceHostnames);
  const existing = await getConfig();

  const currentRoutes: CaddyRoute[] =
    existing?.apps?.http?.servers?.wsproxy?.routes ?? [];

  // Remove any existing routes for this worktree (re-register idempotency)
  const filtered = currentRoutes.filter(
    (r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`)))
  );

  const config: CaddyConfig = {
    apps: {
      http: {
        servers: {
          wsproxy: {
            listen: [":443", ":80"],
            routes: [...filtered, ...newRoutes],
          },
        },
      },
    },
  };

  await loadConfig(config);
}

export async function deregisterCaddy(worktreeName: string): Promise<void> {
  const existing = await getConfig();
  if (!existing) return;

  const currentRoutes: CaddyRoute[] =
    existing?.apps?.http?.servers?.wsproxy?.routes ?? [];

  const filtered = currentRoutes.filter(
    (r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`)))
  );

  const config: CaddyConfig = {
    ...existing,
    apps: {
      http: {
        servers: {
          wsproxy: {
            ...existing?.apps?.http?.servers?.wsproxy,
            routes: filtered,
          },
        },
      },
    },
  };

  await loadConfig(config);
}

export async function isCaddyRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${CADDY_ADMIN}/config/`);
    return res.ok;
  } catch {
    return false;
  }
}
