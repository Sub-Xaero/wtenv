const CADDY_ADMIN = "http://localhost:2019";
async function getConfig() {
    try {
        const res = await fetch(`${CADDY_ADMIN}/config/`);
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch {
        return null;
    }
}
async function loadConfig(config) {
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
function buildRoutes(worktreeName, tld, ports, serviceHostnames) {
    const routes = [];
    const wildcardPort = Object.entries(serviceHostnames)
        .filter(([, hostname]) => hostname === "*")
        .map(([service]) => ports[service])[0];
    // Specific-hostname routes first (higher priority in Caddy)
    for (const [service, hostname] of Object.entries(serviceHostnames)) {
        if (hostname === "*")
            continue;
        const port = ports[service];
        if (port === undefined)
            continue;
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
export async function registerCaddy(worktreeName, tld, ports, serviceHostnames) {
    const newRoutes = buildRoutes(worktreeName, tld, ports, serviceHostnames);
    const existing = await getConfig();
    const currentRoutes = existing?.apps?.http?.servers?.wsproxy?.routes ?? [];
    // Remove any existing routes for this worktree (re-register idempotency)
    const filtered = currentRoutes.filter((r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`))));
    const config = {
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
export async function deregisterCaddy(worktreeName) {
    const existing = await getConfig();
    if (!existing)
        return;
    const currentRoutes = existing?.apps?.http?.servers?.wsproxy?.routes ?? [];
    const filtered = currentRoutes.filter((r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`))));
    const config = {
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
export async function isCaddyRunning() {
    try {
        const res = await fetch(`${CADDY_ADMIN}/config/`);
        return res.ok;
    }
    catch {
        return false;
    }
}
