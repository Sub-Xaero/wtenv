# wtenv

Per-worktree DNS namespaces, HTTPS reverse proxying, port allocation, and database isolation for Conductor-managed git worktrees on macOS.

## What it does

When you work across multiple git worktrees (e.g. `main`, `feature/payments`, `fix/auth`), each needs its own ports, local domain, and optionally its own database. wtenv automates all of that through a plugin pipeline defined in a `.wtenv.config.js` at your git root:

- **Port allocation** — assigns unique ports to each service per worktree, no conflicts
- **DNS** — routes `*.{worktree}.test` to localhost via dnsmasq
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

Then in each project that uses wtenv as a config import:

```bash
npm link wtenv
```

## One-time setup

```bash
wtenv setup
```

Installs and configures dnsmasq, writes `/etc/resolver/test` for macOS DNS routing, configures pfctl to forward port 53 → 5300 (so dnsmasq doesn't need root), and trusts Caddy's local CA.

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
      namePattern: 'myapp_development_{worktree}',
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
| `tld` | `"test"` | TLD for all worktree domains |
| `services` | `{ web: { hostname: "*" } }` | Services to allocate ports for |
| `project` | — | Static project domain config (see `wtenv project`) |
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
| `{worktree}` | Worktree name (e.g. `almaty`) |
| `{tld}` | Configured TLD (e.g. `test`) |
| `{domain}` | `{worktree}.{tld}` |
| `{hostname}` | Service's hostname value (empty string for `"*"`) |
| `{fqdn}` | `{hostname}.{domain}`, or just `{domain}` when hostname is `"*"` |

Example — a service on subdomain `assets` with `worktree=almaty`, `tld=test`, port `3101`:

```js
env: {
  VITE_RUBY_PORT: '{port}',         // → "3101"
  VITE_HMR_HOST:  '{fqdn}',         // → "assets.almaty.test"
  ASSETS_URL:     'https://{fqdn}', // → "https://assets.almaty.test"
}
```

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
  worktreeName: string;
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

Allocates ports for each service in `config.services` from `portRange`. Releases them on deregister. **Must come before any plugin that reads `ctx.ports`.**

```js
ports({ portRange: [3100, 4099] })
```

#### `dns()`

Writes a dnsmasq config file routing `*.{worktreeName}.{tld}` to `127.0.0.1`. Removes it on deregister.

#### `caddy()`

Pushes reverse-proxy routes to Caddy's admin API — one route per service, using each service's hostname to determine the domain pattern. Removes routes on deregister.

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
  namePattern: 'myapp_development_{worktree}', // {worktree} → sanitized worktree name
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
