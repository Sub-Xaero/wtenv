import * as http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const CADDY_ADMIN_HOST = "localhost";
const CADDY_ADMIN_PORT = 2019;
const CADDY_CONFIG_DIR = join(process.env.HOME, ".config", "wtenv");
const CADDY_CONFIG_PATH = join(CADDY_CONFIG_DIR, "caddy.json");
function persistConfig(body) {
    mkdirSync(CADDY_CONFIG_DIR, { recursive: true });
    writeFileSync(CADDY_CONFIG_PATH, body);
}
// 7d leaf certs. Caddy's default is 12h; longer is fine for local dev and
// avoids ERR_CERT_DATE_INVALID surprises after a few hours of inactivity.
// Intermediate is bumped to 30d so Caddy doesn't cap leafs below 7d when
// the intermediate is near expiry.
const INTERNAL_CERT_LIFETIME = "168h";
const INTERNAL_INTERMEDIATE_LIFETIME = "720h";
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
function buildTlsPolicies(routes) {
    // Pre-provision certs only for exact names and single-level wildcards (*.foo.test).
    // Multi-level wildcards (*.*.foo.test) are deliberately excluded — Caddy would issue
    // a *.*.foo.test cert which browsers reject (RFC wildcards only cover one label).
    // Those hostnames fall through to the on-demand policy instead.
    const singleLevelSubjects = Array.from(new Set(routes.flatMap((r) => r.match.flatMap((m) => (m.host ?? []).filter((h) => (h.match(/\*/g) ?? []).length <= 1)))));
    const issuer = { module: "internal", lifetime: INTERNAL_CERT_LIFETIME };
    return [
        ...(singleLevelSubjects.length > 0
            ? [{ subjects: singleLevelSubjects, issuers: [issuer] }]
            : []),
        // Catch-all on-demand policy: issues an exact cert per SNI hostname for
        // multi-level subdomains (e.g. pro-company.dev.wavy.test).
        { issuers: [issuer], on_demand: true },
    ];
}
async function writeConfig(listen, routes) {
    const body = JSON.stringify({
        apps: {
            http: {
                servers: {
                    wtenv: { listen, routes },
                },
            },
            tls: {
                automation: { policies: buildTlsPolicies(routes) },
            },
            pki: {
                certificate_authorities: {
                    local: { intermediate_lifetime: INTERNAL_INTERMEDIATE_LIFETIME },
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
    persistConfig(body);
}
async function patchRoutes(newRoutes, filterFn) {
    const existing = await getConfig();
    const currentServer = existing?.apps?.http?.servers?.wtenv;
    const currentRoutes = currentServer?.routes ?? [];
    const listen = currentServer?.listen ?? [":443", ":80"];
    const filtered = currentRoutes.filter(filterFn);
    await writeConfig(listen, [...filtered, ...newRoutes]);
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
            match: [{ host: [
                        `${worktreeName}.${tld}`,
                        `*.${worktreeName}.${tld}`,
                        `*.*.${worktreeName}.${tld}`,
                        `*.*.*.${worktreeName}.${tld}`,
                    ] }],
            handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `localhost:${wildcardPort}` }] }],
        });
    }
    return routes;
}
function buildProjectRoutes(domains) {
    // Sort: specific hostnames first, wildcards last
    const sorted = [...domains].sort((a, b) => {
        const aWild = a.hostname.startsWith("*") ? 1 : 0;
        const bWild = b.hostname.startsWith("*") ? 1 : 0;
        return aWild - bWild;
    });
    return sorted.map((d) => {
        // Expand single wildcard (*.wavy.test) into multi-level wildcards so that
        // deeply nested subdomains like pro-company.dev.wavy.test are also routed.
        const hosts = d.hostname.startsWith("*.")
            ? [d.hostname, `*.${d.hostname}`, `*.*.${d.hostname}`]
            : [d.hostname];
        return {
            match: [{ host: hosts }],
            handle: [{ handler: "reverse_proxy", upstreams: [{ dial: `localhost:${d.port}` }] }],
        };
    });
}
function isWorktreeHost(h, worktreeName, tld) {
    return h === `${worktreeName}.${tld}` || h.includes(`.${worktreeName}.`);
}
export async function registerCaddy(worktreeName, tld, ports, serviceHostnames) {
    const newRoutes = buildWorktreeRoutes(worktreeName, tld, ports, serviceHostnames);
    await patchRoutes(newRoutes, (r) => !r.match.some((m) => m.host?.some((h) => isWorktreeHost(h, worktreeName, tld))));
}
export async function deregisterCaddy(worktreeName, tld) {
    await patchRoutes([], (r) => !r.match.some((m) => m.host?.some((h) => isWorktreeHost(h, worktreeName, tld))));
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
    const currentRoutes = existing?.apps?.http?.servers?.wtenv?.routes ?? [];
    await writeConfig(ports, currentRoutes);
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
