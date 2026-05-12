import { cpSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { registerDnsmasq, deregisterDnsmasq } from "./dnsmasq.js";
import { registerCaddy, deregisterCaddy } from "./caddy.js";
import { bareLocalHostnames, registerMdnsHosts, deregisterMdnsHosts } from "./mdns.js";
import { provisionDatabase, teardownDatabase } from "./database.js";
import { allocatePorts, releasePorts } from "./registry.js";
export function ports(options) {
    const portRange = options?.portRange ?? [3100, 4099];
    return {
        name: "wtenv:ports",
        portRange,
        onRegister(ctx) {
            const serviceNames = Object.keys(ctx.config.services);
            const allocated = allocatePorts(ctx.worktreeName, ctx.cwd, serviceNames, portRange);
            Object.assign(ctx.ports, allocated);
        },
        onDeregister(ctx) {
            releasePorts(ctx.worktreeName);
        },
    };
}
export function dns() {
    return {
        name: "wtenv:dns",
        onRegister(ctx) {
            registerDnsmasq(ctx.worktreeName, ctx.config.tld);
            // For tld: 'local', also publish the bare 2-label name via mDNS since /etc/resolver
            // files don't intercept bare .local queries before mDNSResponder.
            const bareLocals = bareLocalHostnames(`${ctx.worktreeName}.${ctx.config.tld}`, []);
            if (bareLocals.length > 0)
                registerMdnsHosts(ctx.worktreeName, bareLocals);
        },
        onDeregister(ctx) {
            deregisterMdnsHosts(ctx.worktreeName);
            deregisterDnsmasq(ctx.worktreeName, ctx.config.tld);
        },
    };
}
export function caddy() {
    return {
        name: "wtenv:caddy",
        async onRegister(ctx) {
            const serviceHostnames = Object.fromEntries(Object.entries(ctx.config.services).map(([name, cfg]) => [name, cfg.hostname]));
            await registerCaddy(ctx.worktreeName, ctx.config.tld, ctx.ports, serviceHostnames);
        },
        async onDeregister(ctx) {
            await deregisterCaddy(ctx.worktreeName, ctx.config.tld);
        },
    };
}
export function serviceEnv() {
    return {
        name: "wtenv:service-env",
        onRegister(ctx) {
            for (const [name, cfg] of Object.entries(ctx.config.services)) {
                const port = ctx.ports[name];
                if (port === undefined || !cfg.env)
                    continue;
                const hostname = cfg.hostname === "*" ? "" : cfg.hostname;
                const domain = `${ctx.worktreeName}.${ctx.config.tld}`;
                const fqdn = hostname ? `${hostname}.${domain}` : domain;
                const vars = {
                    port: String(port),
                    worktree: ctx.worktreeName,
                    tld: ctx.config.tld,
                    hostname,
                    domain,
                    fqdn,
                };
                for (const [key, template] of Object.entries(cfg.env)) {
                    ctx.envVars[key] = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
                }
            }
        },
    };
}
export function defaultPlugins(opts) {
    return [ports(opts), dns(), caddy(), serviceEnv()];
}
export function copyFiles(options) {
    return {
        name: "wtenv:copy-files",
        onRegister(ctx) {
            if (ctx.configRoot === ctx.cwd) {
                console.warn("  copy-files: configRoot === cwd, skipping");
                return;
            }
            for (const entry of options.files) {
                const src = typeof entry === "string" ? entry : entry.src;
                const dest = typeof entry === "string" ? entry : (entry.dest ?? entry.src);
                const optional = typeof entry !== "string" && (entry.optional ?? false);
                const srcPath = join(ctx.configRoot, src);
                const destPath = join(ctx.cwd, dest);
                if (!existsSync(srcPath)) {
                    if (optional) {
                        console.log(`  copy-files: skipping optional '${src}' (not found)`);
                        continue;
                    }
                    throw new Error(`copy-files: required file not found: ${srcPath}`);
                }
                mkdirSync(dirname(destPath), { recursive: true });
                cpSync(srcPath, destPath, { recursive: true });
            }
        },
    };
}
export function shell(options) {
    return {
        name: "wtenv:shell",
        onRegister(ctx) {
            runCommands(options.onRegister ?? [], ctx);
        },
        onDeregister(ctx) {
            runCommands(options.onDeregister ?? [], ctx);
        },
    };
}
function runCommands(commands, ctx) {
    const env = { ...process.env, ...ctx.envVars };
    for (const cmd of commands) {
        const result = spawnSync(cmd, { shell: true, stdio: "inherit", cwd: ctx.cwd, env });
        if (result.status !== 0) {
            throw new Error(`shell: command failed (exit ${result.status ?? "?"}): ${cmd}`);
        }
    }
}
export function direnv(options = {}) {
    const envFile = options.envFile ?? ".env.worktree";
    return {
        name: "wtenv:direnv",
        onRegister(ctx) {
            writeFileSync(join(ctx.cwd, ".envrc"), `dotenv ${envFile}\n`);
        },
        onDeregister(ctx) {
            const envrcPath = join(ctx.cwd, ".envrc");
            if (existsSync(envrcPath)) {
                unlinkSync(envrcPath);
            }
        },
    };
}
export function postgres(options) {
    return {
        name: "wtenv:postgres",
        onRegister(ctx) {
            const dbUrl = provisionDatabase(ctx.worktreeName, options);
            ctx.envVars[options.envVar] = dbUrl;
        },
        onDeregister(ctx) {
            teardownDatabase(ctx.worktreeName, options);
        },
    };
}
