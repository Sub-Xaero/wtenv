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
async function patchRoutes(newRoutes, filterFn) {
    const existing = await getConfig();
    const currentServer = existing?.apps?.http?.servers?.wsproxy;
    const currentRoutes = currentServer?.routes ?? [];
    // Preserve the existing listener config; fall back to :443 + :80 if no server yet
    const listen = currentServer?.listen ?? [":443", ":80"];
    const filtered = currentRoutes.filter(filterFn);
    const body = JSON.stringify({
        apps: {
            http: {
                servers: {
                    wsproxy: {
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
    });
    const { status, data } = await httpRequest({
        hostname: CADDY_ADMIN_HOST,
        port: CADDY_ADMIN_PORT,
        path: "/load",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, body);
    if (status !== 200)
        throw new Error(`Caddy load failed (${status}): ${data}`);
}
function buildWorktreeRoutes(worktreeName, tld, ports, serviceHostnames) {
    const routes = [];
    const wildcardPort = Object.entries(serviceHostnames)
        .filter(([, h]) => h === "*")
        .map(([svc]) => ports[svc])[0];
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
    if (wildcardPort !== undefined) {
        routes.push({
            match: [{ host: [`*.${worktreeName}.${tld}`] }],
            handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `localhost:${wildcardPort}` }] }],
        });
    }
    return routes;
}
function buildProjectRoutes(domains) {
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
export async function registerCaddy(worktreeName, tld, ports, serviceHostnames) {
    const newRoutes = buildWorktreeRoutes(worktreeName, tld, ports, serviceHostnames);
    await patchRoutes(newRoutes, (r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`))));
}
export async function deregisterCaddy(worktreeName) {
    await patchRoutes([], (r) => !r.match.some((m) => m.host?.some((h) => h.includes(`.${worktreeName}.`))));
}
export async function registerProjectCaddy(projectName, domains) {
    const newRoutes = buildProjectRoutes(domains);
    await patchRoutes(newRoutes, (r) => !r.match.some((m) => m.host?.some((h) => isProjectRoute(h, projectName, domains))));
}
export async function deregisterProjectCaddy(projectName, domains) {
    await patchRoutes([], (r) => !r.match.some((m) => m.host?.some((h) => isProjectRoute(h, projectName, domains))));
}
function isProjectRoute(host, _projectName, domains) {
    return domains.some((d) => d.hostname === host);
}
export async function setListener(ports) {
    const existing = await getConfig();
    const currentRoutes = existing?.apps?.http?.servers?.wsproxy?.routes ?? [];
    const body = JSON.stringify({
        apps: {
            http: {
                servers: {
                    wsproxy: {
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
    });
    const { status, data } = await httpRequest({
        hostname: CADDY_ADMIN_HOST,
        port: CADDY_ADMIN_PORT,
        path: "/load",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, body);
    if (status !== 200)
        throw new Error(`Caddy load failed (${status}): ${data}`);
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
