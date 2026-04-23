import * as http from "node:http";
const CADDY_ADMIN_HOST = "localhost";
const CADDY_ADMIN_PORT = 2019;
function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk.toString(); });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, data }));
        });
        req.on("error", reject);
        if (body)
            req.write(body);
        req.end();
    });
}
async function getConfig() {
    try {
        const { status, data } = await httpRequest({
            hostname: CADDY_ADMIN_HOST,
            port: CADDY_ADMIN_PORT,
            path: "/config/",
            method: "GET",
        });
        if (status !== 200)
            return null;
        return JSON.parse(data);
    }
    catch {
        return null;
    }
}
async function loadConfig(config) {
    const body = JSON.stringify(config);
    const { status, data } = await httpRequest({
        hostname: CADDY_ADMIN_HOST,
        port: CADDY_ADMIN_PORT,
        path: "/load",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
        },
    }, body);
    if (status !== 200) {
        throw new Error(`Caddy load failed (${status}): ${data}`);
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
    const filtered = currentRoutes.filter((r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`))));
    const config = {
        apps: {
            http: {
                servers: {
                    wsproxy: {
                        listen: [":80"],
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
        const { status } = await httpRequest({
            hostname: CADDY_ADMIN_HOST,
            port: CADDY_ADMIN_PORT,
            path: "/config/",
            method: "GET",
        });
        return status === 200;
    }
    catch {
        return false;
    }
}
