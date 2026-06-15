# wtenv

Per-worktree DNS namespaces, HTTPS reverse proxying, port allocation, and database isolation for Conductor-managed git worktrees on macOS.

## What it does

When you work across multiple git worktrees (e.g. `main`, `feature/payments`, `fix/auth`), each needs its own ports, local domain, and optionally its own database. wtenv automates all of that through a plugin pipeline defined in a `.wtenv.config.js` at your git root:

- **Port allocation** — assigns unique ports to each service per worktree, no conflicts
- **DNS** — checks out an animal name from a bundled pool and routes `*.{domain}.test` to localhost via dnsmasq. `WTENV_DOMAIN` is auto-exported so processes can identify their own domain.
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
    web:  { hostname: '*',      env: { PORT: '{port}', APP_DOMAIN: '{host}' } },
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
      namePattern: 'myapp_development_{domain}',
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
| `aliases` | — | URL shortcuts for `wtenv open` / `wtenv project open` (no ports, no Caddy routes — just a subdomain prefix lookup). See [Aliases](#aliases) |
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
| `{domain}` | Checked-out animal name — also auto-exported as `WTENV_DOMAIN` |
| `{tld}` | Configured TLD (e.g. `test`) |
| `{host}` | `{domain}.{tld}` |
| `{hostname}` | Service's hostname value (empty string for `"*"`) |
| `{fqdn}` | `{hostname}.{host}`, or just `{host}` when hostname is `"*"` |

`WTENV_DOMAIN` is always written into `.env.worktree` so consuming processes can identify their domain without templating it themselves.

Example — a service on subdomain `assets`, domain `otter`, `tld=test`, port `3101`:

```js
env: {
  VITE_RUBY_PORT: '{port}',         // → "3101"
  VITE_HMR_HOST:  '{fqdn}',         // → "assets.otter.test"
  ASSETS_URL:     'https://{fqdn}', // → "https://assets.otter.test"
}
```

### Aliases

Short names for full subdomain paths, resolved by `wtenv open` and `wtenv project open`. Aliases don't allocate ports or add Caddy routes — they're pure URL shortcuts for things that already resolve through the wildcard DNS rule.

```js
defineConfig({
  // ...
  aliases: {
    pro:     'pro-company.dev',
    staging: 'staging-environment',
  },
})
```

Then:

```bash
wtenv open pro             # https://pro-company.dev.<domain>.<tld>
wtenv project open pro     # https://pro-company.dev.<baseDomain>
```

Resolution order for `wtenv open <arg>`: **service name** → **alias name** → **literal subdomain**. Services win on collision (they're "real" — they have ports + Caddy routes). For `wtenv project open <arg>` there are no services, so the order is just alias → literal.

---

## The env stack

wtenv layers three dotenv files, each overriding the one before it:

| Layer | Written by | Purpose |
|---|---|---|
| `.env` | you (committed) | shared base config |
| `.env.local` | you (gitignored) | personal/machine-local overrides |
| `.env.worktree` | `wtenv register` | per-worktree ports, domain, `DATABASE_URL`, `WTENV_DOMAIN`, etc. |

The recommended way to load this stack into your shell is [direnv](https://direnv.net): `wtenv register` writes an `.envrc` that does `dotenv_if_exists` for all three files, so the environment is loaded automatically when you `cd` in.

### Shells without direnv

If you don't run direnv, `wtenv env` reads the same three files (in the same order) on demand:

```bash
# Load the full stack into the current shell
eval "$(wtenv env export)"

# Inspect the merged stack — shows which layer each value won from
wtenv env show

# Clear the vars the stack defines (the inverse of export)
eval "$(wtenv env unset)"
```

- `export` / `unset` emit POSIX `export KEY='value'` / `unset KEY` lines on **stdout** (POSIX shells — bash, zsh); informational notes go to stderr so `eval` stays clean. Values are single-quoted, so spaces, URLs, and embedded quotes survive intact.
- `export` deliberately emits **only** what the files define — it doesn't echo your existing environment back at itself.
- This is a **point-in-time snapshot**, not a live overlay. If you `cd` away or edit the files, the loaded vars persist in that shell until you `wtenv env unset` (or start a new shell). direnv is the better choice if you want automatic, directory-scoped loading.
- All three accept `--env-file <filename>` (default `.env.worktree`, matching `register`) and `--cwd <path>` (default: current directory).

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
| DNS | `*.{domain}.{tld}` | `*.{baseDomain}` |
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
  domain:       string;           // checked-out animal name — used as {domain}.{tld} DNS domain (populated by ports())
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

Allocates a registry row for the worktree: assigns ports for each service in `config.services` from `portRange`, checks out an unused animal name from the bundled pool (used as the DNS domain), and writes `WTENV_DOMAIN` to `ctx.envVars`. Releases everything on deregister. **Must come before any plugin that reads `ctx.ports` or `ctx.domain`.**

The registry is keyed by the worktree's git-dir path (stable across directory renames), not by the directory basename — so renaming a conductor worktree doesn't orphan its registration.

```js
ports({ portRange: [3100, 4099] })
```

#### `dns()`

Writes a dnsmasq config file routing `*.{worktreeName}.{tld}` to `127.0.0.1`. Removes it on deregister.

#### `caddy()`

Pushes reverse-proxy routes to Caddy's admin API — one route per service, using each service's hostname together with the worktree's domain to determine the pattern (`{hostname}.{domain}.{tld}`). Removes routes on deregister.

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
    { src: 'storage', optional: true, symlink: true },    // symlink instead of copy
  ],
})
```

Entry options: `src` (required), `dest` (defaults to `src`), `optional` (skip if the source is missing instead of throwing), and `symlink`.

With `symlink: true`, the entry is symlinked (`dest` → `src` in the main checkout) rather than copied — use it for shared, mutable directories that should stay in sync across worktrees, like Active Storage's `storage/`. Symlinks are left untouched if `dest` already exists (a real file/dir or a prior link), and are removed on deregister — but only if `dest` is still a symlink, so real data that replaced one is never deleted. Copied (non-symlink) files are left in place on deregister.

Plugins run in array order on register (reverse order on deregister), so you can interleave multiple `copyFiles` and `shell` calls to control sequencing. Pass `label` to either to distinguish instances in the step log — e.g. `copyFiles({ label: 'storage', files: [...] })` shows as `copy-files:storage`.

#### `postgres(options)`

Creates a PostgreSQL database for the worktree on register. Optionally forks an existing database via `pg_dump` / `pg_restore`. Drops the database on deregister.

```js
postgres({
  namePattern: 'myapp_development_{domain}', // {domain} → sanitized animal name ({city}/{worktree} kept as legacy aliases)
  forkFrom:    'myapp_development',           // optional: clone this database
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
wtenv deregister --domain <name>  # target by domain name without being in the directory
wtenv deregister --stale          # remove all orphaned entries whose worktree no longer exists

# Preview what register would do without making changes
wtenv register --dry-run

# List all registered worktrees with ports and URLs
wtenv list

# Check dnsmasq and Caddy health
wtenv status

# Diagnose the full wtenv setup — services, config, and registry
wtenv doctor

# Open this worktree's domain in the browser.
# - No arg     → https://<domain>.<tld>
# - Service    → resolves the arg against config.services (e.g. `vite` with hostname `assets` → https://assets.<domain>.<tld>)
# - Otherwise  → treats the arg as a literal subdomain (e.g. `admin` → https://admin.<domain>.<tld>)
# Use --print to emit the URL instead of opening a browser (handy for shell pipelines).
wtenv open [arg] [--print]

# Kill listening processes bound to this worktree's allocated ports.
# Defaults to SIGTERM (graceful); use --force / -f for SIGKILL.
wtenv kill [--force] [--dry-run]

# Load / inspect / clear the .env + .env.local + .env.worktree stack
# (for shells without direnv — all accept --env-file and --cwd)
eval "$(wtenv env export)"   # export KEY=VALUE lines for the current shell
wtenv env show               # human-readable merged stack with source layers
eval "$(wtenv env unset)"    # unset every key the stack defines

# Register/deregister/open/kill static project domains (non-worktree)
wtenv project register [--config-root <path>]
wtenv project deregister [--config-root <path>]
wtenv project open [arg] [--print]   # arg is prepended as a literal subdomain of baseDomain
wtenv project kill [--force] [--dry-run]
```

`name`, `cwd`, and `configRoot` are all derived from git automatically. Pass `name` explicitly only if you need to override.

### `wtenv doctor`

Runs a structured health check across three areas and reports each item as `✓ pass`, `⚠ warn`, or `✗ fail` with a suggested fix command:

- **Infrastructure** — dnsmasq running, `/etc/resolver/test` present, Caddy admin API responding, DNS resolution of `*.test → 127.0.0.1`, PostgreSQL reachable via `pg_isready`
- **Config** — config file found, loads without errors, at least one service defined, TLD set
- **Registry** — for each registered worktree: git-dir still exists, dnsmasq conf file present, and any port conflicts (processes listening on allocated ports that don't belong to the worktree itself)

Exits with code 1 if any check fails, 0 if all checks are pass or warn. Useful after OS upgrades, environment resets, or onboarding to a new machine.

---

## How it works

Port assignments and worktree metadata are stored in a SQLite registry at `~/.wtenv/registry.db`. On `register`, wtenv runs the plugin pipeline in order: ports are allocated from the registry, dnsmasq conf files are written to `/opt/homebrew/etc/dnsmasq.d/`, reverse-proxy routes are pushed to Caddy via its admin API (`localhost:2019`), any database is provisioned, and all accumulated env vars are written to `.env.worktree`. On `deregister`, the pipeline runs in reverse.

`register` and `deregister` print a coloured plugin-by-plugin trace so wtenv's own output is visually distinct from subprocess output (bundle/yarn/rails). Set `NO_COLOR=1` (or pipe to a non-TTY) to get plain text.

## Backwards compatibility

Plain `.wtenv.json` files still work — `normalizeConfig` automatically injects `defaultPlugins()` and converts a `database` field to a `postgres()` plugin. The `portRange` field in `.wtenv.json` is passed through to the ports plugin. No changes needed to existing JSON configs.
