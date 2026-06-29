import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { registerDnsmasq, deregisterDnsmasq } from "./dnsmasq.js";
import { registerCaddy, deregisterCaddy } from "./caddy.js";
import { bareLocalHostnames, registerMdnsHosts, deregisterMdnsHosts } from "./mdns.js";
import { provisionDatabase, teardownDatabase } from "./database.js";
import { provisionRedis, teardownRedis } from "./redis.js";
import { allocateWorktree, releaseWorktree, allocateRedisDb, releaseRedisDb, getRedisDb } from "./registry.js";
import { appendCapturedLog, captureLogs, flushCapturedLog, info, cmd, warn } from "./log.js";
import { executePlan, isPlanGroup } from "./plan.js";
// Allocates the worktree's registry row, including a checked-out animal name
// (the slug) from the bundled pool and per-service ports. Also seeds `ctx.slug`
// and exports `WTENV_SLUG` (the bare label) plus `WTENV_DOMAIN` (slug.tld) so
// downstream plugins (and the consuming app) can read them.
export function ports(options) {
    const portRange = options?.portRange ?? [3100, 4099];
    return {
        name: "wtenv:ports",
        portRange,
        slugHint: options?.slug,
        onRegister(ctx) {
            const serviceNames = Object.keys(ctx.config.services);
            const { slug, ports: allocated } = allocateWorktree(ctx.worktreeId, ctx.worktreeName, ctx.cwd, serviceNames, portRange, { slugHint: this.slugHint });
            ctx.slug = slug;
            Object.assign(ctx.ports, allocated);
            ctx.envVars.WTENV_SLUG = slug;
            ctx.envVars.WTENV_DOMAIN = `${slug}.${ctx.config.tld}`;
            info(`slug: ${slug}`);
            const portList = Object.entries(allocated)
                .map(([s, p]) => `${s}=${p}`)
                .join("  ");
            info(`ports: ${portList}`);
        },
        onDeregister(ctx) {
            releaseWorktree(ctx.worktreeId);
            info(`released slug '${ctx.slug}' and ports`);
        },
    };
}
export function dns() {
    return {
        name: "wtenv:dns",
        onRegister(ctx) {
            registerDnsmasq(ctx.slug, ctx.config.tld);
            info(`wrote dnsmasq.d/${ctx.slug}.conf`);
            // For tld: 'local', also publish the bare 2-label name via mDNS since /etc/resolver
            // files don't intercept bare .local queries before mDNSResponder.
            const bareLocals = bareLocalHostnames(`${ctx.slug}.${ctx.config.tld}`, []);
            if (bareLocals.length > 0) {
                registerMdnsHosts(ctx.slug, bareLocals);
                info(`published mDNS for ${bareLocals.join(", ")}`);
            }
        },
        onDeregister(ctx) {
            deregisterMdnsHosts(ctx.slug);
            deregisterDnsmasq(ctx.slug, ctx.config.tld);
            info(`removed dnsmasq.d/${ctx.slug}.conf`);
        },
    };
}
export function caddy() {
    return {
        name: "wtenv:caddy",
        async onRegister(ctx) {
            const serviceHostnames = Object.fromEntries(Object.entries(ctx.config.services).map(([name, cfg]) => [name, cfg.hostname]));
            await registerCaddy(ctx.slug, ctx.config.tld, ctx.ports, serviceHostnames);
            const n = Object.keys(serviceHostnames).length;
            info(`added ${n} route${n === 1 ? "" : "s"} for ${ctx.slug}.${ctx.config.tld}`);
        },
        async onDeregister(ctx) {
            await deregisterCaddy(ctx.slug, ctx.config.tld);
            info(`removed routes for ${ctx.slug}.${ctx.config.tld}`);
        },
    };
}
export function serviceEnv() {
    return {
        name: "wtenv:service-env",
        onRegister(ctx) {
            let count = 0;
            for (const [name, cfg] of Object.entries(ctx.config.services)) {
                const port = ctx.ports[name];
                if (port === undefined || !cfg.env)
                    continue;
                const hostname = cfg.hostname === "*" || cfg.hostname === false ? "" : cfg.hostname;
                const domain = `${ctx.slug}.${ctx.config.tld}`;
                const fqdn = hostname ? `${hostname}.${domain}` : domain;
                const vars = {
                    port: String(port),
                    worktree: ctx.worktreeName,
                    slug: ctx.slug,
                    tld: ctx.config.tld,
                    hostname,
                    domain,
                    fqdn,
                };
                for (const [key, template] of Object.entries(cfg.env)) {
                    ctx.envVars[key] = template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
                    count++;
                }
            }
            info(`expanded ${count} env var${count === 1 ? "" : "s"}`);
        },
    };
}
export function defaultPlugins(opts) {
    return [ports(opts), dns(), caddy(), serviceEnv()];
}
function normalizeCopyEntry(entry) {
    const isObject = typeof entry === "object" && entry !== null && !Array.isArray(entry);
    if (typeof entry !== "string" && !isObject) {
        throw new Error(`copy-files: entry must be a string or { src, dest?, optional?, symlink? }, got: ${JSON.stringify(entry)}`);
    }
    if (isObject && typeof entry.src !== "string") {
        throw new Error(`copy-files: entry is missing required 'src' string, got: ${JSON.stringify(entry)}`);
    }
    return {
        src: typeof entry === "string" ? entry : entry.src,
        dest: typeof entry === "string" ? entry : (entry.dest ?? entry.src),
        optional: typeof entry !== "string" && (entry.optional ?? false),
        symlink: typeof entry !== "string" && (entry.symlink ?? false),
    };
}
// lstat-based existence checks so we inspect the link itself, never its target:
// `pathPresent` is true for a real file/dir or any symlink (incl. broken ones),
// and `isSymlink` distinguishes links we created from real worktree data.
function pathPresent(p) {
    try {
        lstatSync(p);
        return true;
    }
    catch {
        return false;
    }
}
function isSymlink(p) {
    try {
        return lstatSync(p).isSymbolicLink();
    }
    catch {
        return false;
    }
}
export function copyFiles(options) {
    return {
        name: options.label ? `wtenv:copy-files:${options.label}` : "wtenv:copy-files",
        onRegister(ctx) {
            const sourceRoot = options.from ? resolve(ctx.gitRoot, options.from) : ctx.gitRoot;
            if (sourceRoot === ctx.cwd) {
                warn("source === cwd, skipping copy-files");
                return;
            }
            let copied = 0;
            let linked = 0;
            let skipped = 0;
            for (const entry of options.files) {
                const { src, dest, optional, symlink } = normalizeCopyEntry(entry);
                const srcPath = join(sourceRoot, src);
                const destPath = join(ctx.cwd, dest);
                if (!existsSync(srcPath)) {
                    if (optional) {
                        info(`skipping optional '${src}' (not found)`);
                        skipped++;
                        continue;
                    }
                    throw new Error(`copy-files: required file not found: ${srcPath}`);
                }
                if (symlink) {
                    // Never clobber a path the worktree already has — a real file/dir or a
                    // pre-existing link (e.g. from a re-register). Leave it untouched.
                    if (pathPresent(destPath)) {
                        info(`skipping symlink '${dest}' (already exists)`);
                        skipped++;
                        continue;
                    }
                    mkdirSync(dirname(destPath), { recursive: true });
                    symlinkSync(srcPath, destPath);
                    linked++;
                }
                else {
                    mkdirSync(dirname(destPath), { recursive: true });
                    cpSync(srcPath, destPath, { recursive: true });
                    copied++;
                }
            }
            const parts = [`copied ${copied} file${copied === 1 ? "" : "s"}`];
            if (linked > 0)
                parts.push(`linked ${linked}`);
            if (skipped > 0)
                parts.push(`${skipped} skipped`);
            info(parts.join(", "));
        },
        onDeregister(ctx) {
            const sourceRoot = options.from ? resolve(ctx.gitRoot, options.from) : ctx.gitRoot;
            if (sourceRoot === ctx.cwd)
                return;
            let removed = 0;
            for (const entry of options.files) {
                const { dest, symlink } = normalizeCopyEntry(entry);
                if (!symlink)
                    continue;
                const destPath = join(ctx.cwd, dest);
                // Only remove our own symlinks — never a real file/dir that replaced one.
                if (isSymlink(destPath)) {
                    unlinkSync(destPath);
                    removed++;
                }
            }
            if (removed > 0)
                info(`removed ${removed} symlink${removed === 1 ? "" : "s"}`);
        },
    };
}
export function shell(options) {
    return {
        name: options.label ? `wtenv:shell:${options.label}` : "wtenv:shell",
        async onRegister(ctx) {
            await runCommands(options.onRegister ?? [], ctx);
        },
        async onDeregister(ctx) {
            await runCommands(options.onDeregister ?? [], ctx);
        },
    };
}
// The dotenv files direnv layers before the worktree env (`.env.worktree`).
// Shared with the direnv() plugin and `wtenv env export` so register-time,
// run-time, and the manual export path all stay in lockstep.
export const DOTENV_LAYERS = [".env", ".env.local"];
// Reproduce direnv's runtime environment so shell commands see the same vars the
// running app will. Layering matches the generated .envrc:
// process.env < .env < .env.local < ctx.envVars (wtenv-generated values win last).
// ctx.envVars stands in for the `.env.worktree` layer, which isn't written to disk
// until after all plugins finish.
function containsPlanGroup(plan) {
    if (isPlanGroup(plan))
        return true;
    if (!Array.isArray(plan))
        return false;
    return plan.some((item) => isPlanGroup(item) && containsPlanGroup(item));
}
function composeWorktreeEnv(ctx) {
    const env = { ...process.env };
    for (const file of DOTENV_LAYERS) {
        const p = join(ctx.cwd, file);
        if (existsSync(p))
            Object.assign(env, parseEnv(readFileSync(p, "utf8")));
    }
    Object.assign(env, ctx.envVars);
    return env;
}
function runCommands(commands, ctx) {
    const env = composeWorktreeEnv(ctx);
    if (!containsPlanGroup(commands)) {
        const commandList = (Array.isArray(commands) ? commands : [commands]);
        for (const command of commandList)
            runCommandSync(command, ctx, env);
        return;
    }
    return executePlan(commands, async (command) => {
        const captured = await captureLogs(() => runCommand(command, ctx, env));
        flushCapturedLog(captured.output);
        if (!captured.ok)
            throw captured.error;
    }).then(() => undefined);
}
function runCommandSync(command, ctx, env) {
    cmd(command);
    const result = spawnSync(command, { shell: true, stdio: "pipe", cwd: ctx.cwd, env });
    if (result.stdout)
        appendCapturedLog(result.stdout.toString());
    if (result.stderr)
        appendCapturedLog(result.stderr.toString(), "stderr");
    if (result.status !== 0) {
        throw new Error(`shell: command failed (exit ${result.status ?? "?"}): ${command}`);
    }
}
function runCommand(command, ctx, env) {
    cmd(command);
    return new Promise((resolve, reject) => {
        const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"], cwd: ctx.cwd, env });
        child.stdout?.on("data", (chunk) => appendCapturedLog(chunk.toString()));
        child.stderr?.on("data", (chunk) => appendCapturedLog(chunk.toString(), "stderr"));
        child.on("error", reject);
        child.on("close", (code, signal) => {
            if (code === 0) {
                resolve();
                return;
            }
            const status = code === null ? `signal ${signal ?? "?"}` : `exit ${code}`;
            reject(new Error(`shell: command failed (${status}): ${command}`));
        });
    });
}
export function direnv(options = {}) {
    const envFile = options.envFile ?? ".env.worktree";
    // Later files override earlier ones in direnv's dotenv loader, so worktree
    // overrides local overrides base. Each line is skipped at eval time if the
    // file isn't present.
    const sources = [...DOTENV_LAYERS, envFile];
    return {
        name: "wtenv:direnv",
        onRegister(ctx) {
            const body = sources.map((f) => `dotenv_if_exists ${f}`).join("\n") + "\n";
            writeFileSync(join(ctx.cwd, ".envrc"), body);
            info(`wrote .envrc (dotenv_if_exists ${sources.join(", ")})`);
        },
        onDeregister(ctx) {
            const envrcPath = join(ctx.cwd, ".envrc");
            if (existsSync(envrcPath)) {
                unlinkSync(envrcPath);
                info("removed .envrc");
            }
        },
    };
}
export function postgres(options) {
    return {
        name: "wtenv:postgres",
        async onRegister(ctx) {
            const dbUrl = await provisionDatabase(ctx.slug, options);
            ctx.envVars[options.envVar] = dbUrl;
        },
        async onDeregister(ctx) {
            await teardownDatabase(ctx.slug, options);
        },
    };
}
export function redis(options = {}) {
    const { envVar = "REDIS_URL", host, port, flushOnDeregister, dbStart, dbEnd } = options;
    return {
        name: "wtenv:redis",
        onRegister(ctx) {
            const dbIndex = allocateRedisDb(ctx.worktreeId, { dbStart, dbEnd });
            const url = provisionRedis(ctx.slug, dbIndex, { host, port });
            ctx.envVars[envVar] = url;
        },
        onDeregister(ctx) {
            const dbIndex = getRedisDb(ctx.worktreeId);
            if (dbIndex !== null) {
                teardownRedis(ctx.slug, dbIndex, { host, port, flushOnDeregister });
                releaseRedisDb(ctx.worktreeId);
            }
        },
    };
}
