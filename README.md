# wtenv

Worktree proxy and port registry — per-worktree DNS namespaces, HTTPS reverse proxying, and port allocation for Conductor-managed git worktrees on macOS.

## What it does

When you work across multiple git worktrees (e.g. `main`, `feature/payments`, `fix/auth`), each needs its own ports, local domain, and optionally its own database. wtenv automates all of that:

- **Port allocation** — assigns unique ports to each service per worktree, with no conflicts
- **DNS** — routes `*.{worktree}.test` to localhost via dnsmasq
- **HTTPS** — configures Caddy to reverse-proxy each service with a trusted local certificate
- **Database provisioning** — creates and drops isolated PostgreSQL databases per worktree
- **Environment variables** — writes a `.env.worktree` file with all allocated ports and URLs

## Prerequisites

- macOS
- [Homebrew](https://brew.sh)
- Node.js ≥ 18
- dnsmasq (`brew install dnsmasq`)
- Caddy (`brew install caddy`)
- PostgreSQL — optional, only needed if using the `database` config

## Installation

```bash
npm install
npm run build
npm link        # installs wtenv as a global command
```

## One-time setup

```bash
wtenv setup
```

This installs and configures dnsmasq, sets up `/etc/resolver/test` for macOS DNS routing, configures pfctl to forward port 53 → 5353 (so dnsmasq doesn't need root), and trusts Caddy's local CA.

## Configuration

Add a `.wtenv.json` file to your project root:

```json
{
  "portRange": [3100, 4099],
  "tld": "test",
  "services": {
    "web": { "envVar": "PORT", "hostname": "*" },
    "assets": { "envVar": "ASSETS_PORT", "hostname": "assets" }
  },
  "database": {
    "namePattern": "myapp_development_{worktree}",
    "host": "localhost",
    "port": 5432,
    "username": "postgres",
    "password": "",
    "envVar": "DATABASE_URL"
  },
  "project": {
    "name": "myapp",
    "baseDomain": "myapp.local",
    "domains": [
      { "hostname": "myapp.local", "port": 3000 },
      { "hostname": "*.myapp.local", "port": 3001 }
    ]
  }
}
```

If no config file is found, defaults are used: port range `3100–4099`, TLD `test`, single `web` service on `PORT`.

### Service options

| Field | Description |
|---|---|
| `envVar` | Environment variable to write the allocated port to |
| `hostname` | `"*"` for the worktree root domain, or a subdomain like `"assets"` |
| `hmrHostEnvVar` | Optional — writes the full hostname (e.g. `assets.my-branch.test`) to this var |
| `domainEnvVar` | Optional — writes the base domain (e.g. `my-branch.test`) to this var |

## Commands

```bash
# Register a worktree: allocate ports, configure DNS + proxy, write .env.worktree
wtenv register <name> [--cwd <path>] [--config-root <path>] [--env-file <filename>] [--dry-run]

# Deregister a worktree: remove DNS, Caddy routes, release ports, drop database
wtenv deregister <name> [--cwd <path>] [--config-root <path>] [--env-file <filename>]

# List all registered worktrees with their allocated ports and URLs
wtenv list

# Check dnsmasq and Caddy health
wtenv status

# Register/deregister static project domains (non-worktree)
wtenv project register [--config-root <path>]
wtenv project deregister [--config-root <path>]
```

## How it works

Port assignments and worktree metadata are stored in a SQLite registry at `~/.wtenv/registry.db`. On `register`, wtenv picks unused ports from the configured range, writes dnsmasq conf files to `/opt/homebrew/etc/dnsmasq.d/` for DNS routing, pushes reverse proxy routes to Caddy via its admin API (`localhost:2019`), optionally creates a PostgreSQL database using `createdb`, then writes all allocated values to `.env.worktree`. `deregister` reverses every step.
