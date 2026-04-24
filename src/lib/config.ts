import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ServiceConfig {
  envVar: string;
  hostname: string; // "*" for wildcard, or a specific subdomain like "assets"
  hmrHostEnvVar?: string; // if set, writes the full hostname (e.g. assets.dar-es-salaam.test) to this env var
  domainEnvVar?: string; // if set, writes the base domain (e.g. dar-es-salaam.test) to this env var
}

export interface ProjectDomain {
  hostname: string; // "*.campfront.local", "assets.campfront.local", "campfront.local"
  port: number;
}

export interface ProjectConfig {
  name: string;       // used as the dnsmasq conf file name and registry key
  baseDomain: string; // e.g. "campfront.local" — used for /etc/resolver/<baseDomain>
  domains: ProjectDomain[];
}

export interface DatabaseConfig {
  namePattern: string; // e.g. "campfront_development_{worktree}"
  host: string;
  port: number;
  username: string;
  password: string;
  envVar: string; // e.g. "DATABASE_URL"
}

export interface WtenvConfig {
  portRange: [number, number];
  tld: string;
  project?: ProjectConfig;
  database?: DatabaseConfig;
  services: Record<string, ServiceConfig>;
}

const DEFAULTS: WtenvConfig = {
  portRange: [3100, 4099],
  tld: "test",
  services: {
    web: { envVar: "PORT", hostname: "*" },
  },
};

export function loadConfig(cwd: string = process.cwd()): WtenvConfig {
  const configPath = join(cwd, ".wtenv.json");
  if (!existsSync(configPath)) return DEFAULTS;

  const raw = JSON.parse(readFileSync(configPath, "utf8"));

  return {
    portRange: raw.portRange ?? DEFAULTS.portRange,
    tld: raw.tld ?? DEFAULTS.tld,
    project: raw.project,
    database: raw.database,
    services: raw.services ?? DEFAULTS.services,
  };
}
