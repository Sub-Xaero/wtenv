# wtenv

Per-worktree DNS namespaces, HTTPS reverse proxying, port allocation, and database isolation for Conductor-managed git worktrees on macOS.

## What it does

When you work across multiple git worktrees (e.g. `main`, `feature/payments`, `fix/auth`), each needs its own ports, local domain, and optionally its own database. wtenv automates all of that through a plugin pipeline defined in a `.wtenv.config.js` at your git root:

- **Port allocation** — assigns unique ports to each service per worktree, no conflicts
- **DNS** — checks out a city from a bundled pool and routes `*.{city}.test` to localhost via dnsmasq. `WTENV_CITY` is auto-exported so processes can identify their own domain.
- **HTTPS** — configures Caddy to reverse-proxy each service with a trusted local certificate
- **File copying** — seeds credentials and config files from the main checkout into each worktree
- **Database provisioning** — creates and optionally forks an isolated PostgreSQL database per worktree
- **Shell commands** — runs setup steps (bundle install, migrations, etc.) with all allocated env vars available
- **Environment variables** — writes a `.env.worktree` file with all values set by the plugin pipeline

## Prerequisites

- macOS
- [Homebrew](https://brew.sh)
- Node.js ≥ 18
- dnsmasq (`brew install dnsmasq`)
- Caddy (`brew install caddy`)
- PostgreSQL — optional, only needed if using the `postgres()` plugin

## Installation

```bash
npm install
npm run build
npm link        # installs wtenv as a global command
```

You don't need to add `wtenv` to each consuming project's `package.json` or run `npm link wtenv` inside it — `.wtenv.config.js` can `import ... from "wtenv"` directly. wtenv's CLI registers an ESM resolver hook that maps the bare `"wtenv"` specifier to the globally-linked package before importing the config.

### Editor type resolution (optional)

The runtime works without any project-side setup, but editors won't resolve types for `import ... from "wtenv"` unless you point them at the linked package. Add a `jsconfig.json` (or extend an existing `tsconfig.json`) at the project root:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "wtenv": ["./node_modules/wtenv/dist/lib/exports.d.ts"]
    }
  }
}
```

…then run `npm link wtenv` once in the project to create the `node_modules/wtenv` symlink the editor reads. This is editor-only — it doesn't touch `package.json` or the lockfile.

## One-time setup

```bash
wtenv setup
```

Installs and configures dnsmasq (listening on port 5300 so it doesn't need root), writes `/etc/resolver/test` pointing macOS's resolver at `127.0.0.1:5300`, and trusts Caddy's local CA.

## Configuration

Create a `.wtenv.config.js` at your git root (the main checkout, not inside a worktree):

```js
import { defineConfig, defaultPlugins, copyFiles, shell, postgres } from 'wtenv';

export default defineConfig({
  tld: 'test',
  services: {
    web:  { hostname: '*',      env: { PORT: '{port}', APP_DOMAIN: '{domain}' } },
    vite: { hostname: 'assets', env: { VITE_RUBY_PORT: '{port}', VITE_HMR_HOST: '{fqdn}' } },
  },
  plugins: [
    ...defaultPlugins({ portRange: [3100, 4099] }),
    copyFiles({
      files: [
        { src: 'config/master.key' },
        { src: 'config/database.yml' },
        { src: 'claude.local.md', optional: true },
      ],
    }),
    postgres({
      namePattern: 'myapp_development_{city}',
      forkFrom:    'myapp_development',
      host: 'localhost', port: 5432,
      username: 'myapp', password: 'secret',
      envVar: 'DATABASE_URL',
    }),
    shell({
      onRegister: ['bundle install', 'bundle exec rails db:migrate'],
    }),
  ],
});
```

wtenv auto-detects everything from git — no flags needed:

- **cwd** → `git rev-parse --show-toplevel` (root of the current worktree)
- **configRoot** → `git rev-parse --git-common-dir` resolved to its parent (always the main checkout, whether you're in the main repo or a linked worktree)
- **name** → `basename(cwd)`

### Top-level options

| Field | Default | Description |
|---|---|---|
| `tld` | `"test"` | TLD for all worktree domains. `.local` is supported but requires sudo per `wtenv register` — see [.local caveat](#local-caveat) |
| `services` | `{ web: { hostname: "*" } }` | Services to allocate ports for |
| `project` | — | Static project domain config (see [Project domains](#project-domains)) |
| `plugins` | `[]` | Plugin pipeline — runs in order on register, reverse on deregister |

### Service config

Each entry in `services` defines one addressable service:

| Field | Description |
|---|---|
| `hostname` | `"*"` for the worktree root domain, or a subdomain like `"assets"` |
| `env` | Map of env var names to template strings (see below) |

### Env var templates

The `env` map on each service supports these template variables:

| Variable | Value |
|---|---|
| `{port}` | Allocated port number |
| `{worktree}` | Display name (worktree directory basename — may be unstable if conductor renames the directory) |
| `{city}` | Checked-out city from the bundled pool — also auto-exported as `WTENV_CITY` |
| `{tld}` | Configured TLD (e.g. `test`) |
| `{domain}` | `{city}.{tld}` |
| `{hostname}` | Service's hostname value (empty string for `"*"`) |
| `{fqdn}` | `{hostname}.{domain}`, or just `{domain}` when hostname is `"*"` |

`WTENV_CITY` is always written into `.env.worktree` so consuming processes can identify their domain without templating it themselves.

Example — a service on subdomain `assets`, city `almaty`, `tld=test`, port `3101`:

```js
env: {
  VITE_RUBY_PORT: '{port}',         // → "3101"
  VITE_HMR_HOST:  '{fqdn}',         // → "assets.almaty.test"
  ASSETS_URL:     'https://{fqdn}', // → "https://assets.almaty.test"
}
```

---

## Project domains

The `project` config block registers **static, non-worktree domains** — fixed hostnames that point to specific local ports regardless of which worktree is active. This is useful for services that run once for the whole project (a shared API gateway, a shared asset server, a stub service, etc.).

### Config shape

```js
export default defineConfig({
  // ...
  project: {
    name:       'myapp',          // used as an identifier in dnsmasq/Caddy configs
    baseDomain: 'myapp.test',     // wildcard base — *.myapp.test + myapp.test resolve to 127.0.0.1
    domains: [
      { hostname: 'myapp.test',        port: 5000 }, // root domain
      { hostname: 'api.myapp.test',    port: 5001 }, // subdomain
      { hostname: 'assets.myapp.test', port: 5002 },
    ],
  },
});
```

| Field | Description |
|---|---|
| `name` | Identifier for this project's dnsmasq and Caddy entries |
| `baseDomain` | The shared TLD for this project — dnsmasq routes all `*.baseDomain` traffic to `127.0.0.1`, and `/etc/resolver/<baseDomain>` is created so macOS uses dnsmasq for this domain. `.local` TLDs are supported — see [.local caveat](#local-caveat) |
| `domains` | Array of `{ hostname, port }` entries — Caddy creates an HTTPS reverse-proxy route for each one |

### .local caveat

`.local` is reserved for [mDNS/Bonjour](https://datatracker.ietf.org/doc/html/rfc6762) on macOS, so it needs extra handling — but wtenv supports it for both project and worktree domains.

For project (`baseDomain`) and worktree (`tld`) `.local` domains, wtenv handles things by:

1. Writing a **scoped resolver file** (e.g. `/etc/resolver/myapp.local` for projects, or `/etc/resolver/<worktree>.local` for worktrees) so macOS routes subdomain queries through dnsmasq. Only that specific domain is affected — Bonjour for other `.local` names is unaffected.
2. For the **bare 2-label `.local` name itself** (e.g. `myapp.local`, not `api.myapp.local`), publishing it via mDNS through a LaunchAgent (`~/Library/LaunchAgents/wtenv.mdns.<name>.plist`) that runs `dns-sd -P`. This is necessary because mDNSResponder intercepts bare `.local` queries before consulting `/etc/resolver` files; without mDNS publishing, `getaddrinfo()` (used by browsers and curl) takes 5 seconds to fall through to a fallback. Multi-label subdomains resolve through the resolver file and don't need this.

wtenv deliberately does **not** create a global `/etc/resolver/local` — that would shadow Bonjour for every `.local` name on the machine. The trade-off: each `wtenv register` (or `wtenv project register`) on a `.local` domain prompts once for sudo to write its scoped resolver file.

### Commands

```bash
# Register project domains (writes dnsmasq config + Caddy routes)
wtenv project register [--config-root <path>]

# Remove project domains
wtenv project deregister [--config-root <path>]
```

Both commands read from `.wtenv.config.js` (or `.wtenv.json`) at the git root. Pass `--config-root` to point at a different directory.

### How it differs from worktree registration

| | `wtenv register` | `wtenv project register` |
|---|---|---|
| Ports | Dynamically allocated per worktree | Fixed — you specify the port |
| DNS | `*.{city}.{tld}` | `*.{baseDomain}` |
| `.local` support | ✅ yes (sudo on each register) | ✅ yes (sudo on each register) |
| Intended for | Per-branch environments | Shared/singleton services |
| Persisted in registry | Yes | No |

---

## Plugin system

Plugins are the core abstraction. Each plugin is an object with a `name` and optional `onRegister` / `onDeregister` hooks. Hooks receive a `PluginContext` and can mutate `ctx.ports` and `ctx.envVars`.

```ts
interface Plugin {
  name: string;
  onRegister?(ctx: PluginContext):  Promise<void> | void;
  onDeregister?(ctx: PluginContext): Promise<void> | void;
}

interface PluginContext {
  worktreeId:   string;           // stable identifier (worktree git-dir path — survives directory renames)
  worktreeName: string;           // display name (cwd basename at register time)
  city:         string;           // checked-out city — used as {city}.{tld} DNS domain (populated by ports())
  cwd:          string;           // worktree directory
  configRoot:   string;           // main checkout directory
  ports:        Record<string, number>;  // mutable — populated by ports()
  envVars:      Record<string, string>;  // mutable — accumulated by plugins
  config:       Readonly<WtenvConfig>;
}
```

Plugins run **in order** on register and **in reverse** on deregister (stack discipline). If a plugin fails during register, all completed plugins have their `onDeregister` called as rollback before the error is re-thrown.

### Built-in plugins

#### `ports(opts?)`

Allocates a registry row for the worktree: assigns ports for each service in `config.services` from `portRange`, checks out an unused city from the bundled pool (used as the DNS domain), and writes `WTENV_CITY` to `ctx.envVars`. Releases everything on deregister. **Must come before any plugin that reads `ctx.ports` or `ctx.city`.**

The registry is keyed by the worktree's git-dir path (stable across directory renames), not by the directory basename — so renaming a conductor worktree doesn't orphan its registration.

```js
ports({ portRange: [3100, 4099] })
```

#### `dns()`

Writes a dnsmasq config file routing `*.{worktreeName}.{tld}` to `127.0.0.1`. Removes it on deregister.

#### `caddy()`

Pushes reverse-proxy routes to Caddy's admin API — one route per service, using each service's hostname together with the worktree's checked-out city to determine the domain pattern (`{hostname}.{city}.{tld}`). Removes routes on deregister.

#### `serviceEnv()`

Iterates `config.services`, expands each service's `env` template map using `ctx.ports`, and writes the results into `ctx.envVars`. Runs after `ports()` so port values are available.

#### `defaultPlugins(opts?)`

Convenience function returning `[ports(opts), dns(), caddy(), serviceEnv()]` — the standard infrastructure quartet. Spread it at the start of your plugins array.

```js
plugins: [
  ...defaultPlugins({ portRange: [3100, 4099] }),
  // your plugins follow
]
```

#### `copyFiles(options)`

Copies files from `configRoot` (main checkout) into `cwd` (worktree). Useful for seeding credentials and config files that aren't committed to git.

```js
copyFiles({
  files: [
    'config/master.key',                           // required
    { src: 'config/database.yml' },                // same as string form
    { src: 'claude.local.md', optional: true },    // skipped if missing
    { src: 'config/base.yml', dest: 'config/local.yml' }, // rename on copy
  ],
})
```

No `onDeregister` — copied files are left in place.

#### `postgres(options)`

Creates a PostgreSQL database for the worktree on register. Optionally forks an existing database via `pg_dump` / `pg_restore`. Drops the database on deregister.

```js
postgres({
  namePattern: 'myapp_development_{city}', // {city} → sanitized checked-out city ({worktree} kept as legacy alias)
  forkFrom:    'myapp_development',            // optional: clone this database
  host:        'localhost',
  port:        5432,
  username:    'myapp',
  password:    'secret',
  envVar:      'DATABASE_URL',                 // written to ctx.envVars
})
```

The allocated `DATABASE_URL` is available to subsequent plugins (e.g. `shell`).

#### `shell(options)`

Runs shell commands on register and/or deregister. Commands run with `{ ...process.env, ...ctx.envVars }` so all env vars accumulated by earlier plugins (ports, database URL, etc.) are available.

```js
shell({
  onRegister:   ['bundle install', 'yarn install', 'bundle exec rails db:migrate'],
  onDeregister: ['bundle exec rails db:drop'],  // optional
})
```

Commands run in `ctx.cwd` (the worktree directory). Any non-zero exit throws and triggers rollback.

### Writing a custom plugin

```js
function myPlugin(options) {
  return {
    name: 'myapp:my-plugin',
    onRegister(ctx) {
      ctx.envVars.MY_VAR = computeSomething(ctx.worktreeName, options);
    },
    onDeregister(ctx) {
      cleanup(ctx.worktreeName);
    },
  };
}
```

---

## Commands

```bash
# Scaffold a .wtenv.config.js with sensible defaults (auto-detects project name and Postgres deps)
wtenv init [--force] [--cwd <path>]

# Register a worktree — auto-detects name, cwd, and config from git
wtenv register [name] [--env-file <filename>] [--dry-run]

# Deregister a worktree
wtenv deregister [name] [--env-file <filename>]

# Preview what register would do without making changes
wtenv register --dry-run

# List all registered worktrees with ports and URLs
wtenv list

# Check dnsmasq and Caddy health
wtenv status

# Register/deregister static project domains (non-worktree)
wtenv project register [--config-root <path>]
wtenv project deregister [--config-root <path>]
```

`name`, `cwd`, and `configRoot` are all derived from git automatically. Pass `name` explicitly only if you need to override.

---

## How it works

Port assignments and worktree metadata are stored in a SQLite registry at `~/.wtenv/registry.db`. On `register`, wtenv runs the plugin pipeline in order: ports are allocated from the registry, dnsmasq conf files are written to `/opt/homebrew/etc/dnsmasq.d/`, reverse-proxy routes are pushed to Caddy via its admin API (`localhost:2019`), any database is provisioned, and all accumulated env vars are written to `.env.worktree`. On `deregister`, the pipeline runs in reverse.

## Backwards compatibility

Plain `.wtenv.json` files still work — `normalizeConfig` automatically injects `defaultPlugins()` and converts a `database` field to a `postgres()` plugin. The `portRange` field in `.wtenv.json` is passed through to the ports plugin. No changes needed to existing JSON configs.
