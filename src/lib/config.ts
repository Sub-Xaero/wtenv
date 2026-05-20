import { readFileSync, existsSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { defaultPlugins, postgres } from "./plugins.js";

let wtenvResolverRegistered = false;

// Register an ESM resolver hook so `.wtenv.config.js` files can
// `import ... from "wtenv"` without the consuming project needing wtenv in
// its node_modules / package.json. The hook maps the bare specifier
// "wtenv" to this package's own exports.js.
function ensureWtenvResolver(): void {
  if (wtenvResolverRegistered) return;
  const loaderUrl = new URL("./config-loader.js", import.meta.url);
  const wtenvUrl = new URL("./exports.js", import.meta.url).href;
  register(loaderUrl, { data: { wtenvUrl } });
  wtenvResolverRegistered = true;
}

export interface ServiceConfig {
  hostname: string;
  env?: Record<string, string>;
}

export interface ProjectDomain {
  hostname: string;
  port: number;
}

export interface ProjectConfig {
  name: string;
  baseDomain: string;
  domains: ProjectDomain[];
}

export interface DatabaseConfig {
  namePattern: string;
  host: string;
  port: number;
  username: string;
  password: string;
  envVar: string;
  forkFrom?: string;
}

export interface Plugin {
  name: string;
  onRegister?(ctx: PluginContext): Promise<void> | void;
  onDeregister?(ctx: PluginContext): Promise<void> | void;
}

export interface PluginContext {
  worktreeId: string;     // stable identifier (worktree git-dir absolute path)
  worktreeName: string;   // display name (cwd basename — may change if the directory is renamed)
  city: string;           // checked-out city, used as DNS domain ({city}.{tld})
  cwd: string;
  configRoot: string;
  ports: Record<string, number>;
  envVars: Record<string, string>;
  config: Readonly<Omit<WtenvConfig, "plugins">>;
}

export interface WtenvConfig {
  tld: string;
  project?: ProjectConfig;
  database?: DatabaseConfig;
  services: Record<string, ServiceConfig>;
  plugins: Plugin[];
}

const DEFAULTS = {
  tld: "test",
  services: {
    web: { hostname: "*", env: { PORT: "{port}" } },
  },
};

export function defineConfig(
  config: Omit<WtenvConfig, "plugins"> & { plugins?: Plugin[] }
): WtenvConfig {
  return { ...config, plugins: config.plugins ?? [] };
}

export async function loadConfig(configRoot: string = process.cwd()): Promise<WtenvConfig> {
  // Try .wtenv.config.js first (Vite-style JS config)
  const jsConfigPath = join(configRoot, ".wtenv.config.js");
  if (existsSync(jsConfigPath)) {
    ensureWtenvResolver();
    const mod = await import(pathToFileURL(jsConfigPath).href);
    const raw: WtenvConfig = mod.default ?? mod;
    return normalizeConfig(raw, false);
  }

  // Fall back to .wtenv.json
  const jsonConfigPath = join(configRoot, ".wtenv.json");
  if (existsSync(jsonConfigPath)) {
    const raw = JSON.parse(readFileSync(jsonConfigPath, "utf8"));
    return normalizeConfig(raw, true);
  }

  return normalizeConfig({}, true);
}

// fromJson=true: auto-inject defaultPlugins + convert legacy database field
// fromJson=false: JS config controls its own plugin list entirely
function normalizeConfig(
  raw: Partial<WtenvConfig> & { portRange?: [number, number]; database?: DatabaseConfig },
  fromJson: boolean
): WtenvConfig {
  let plugins: Plugin[];

  if (fromJson) {
    // JSON/default configs get the infrastructure plugins injected automatically.
    // portRange lives in the ports() plugin options, not on WtenvConfig.
    plugins = [...defaultPlugins({ portRange: raw.portRange })];
    if (raw.database) plugins.push(postgres(raw.database));
  } else {
    plugins = raw.plugins ?? [];
  }

  return {
    tld: raw.tld ?? DEFAULTS.tld,
    project: raw.project,
    database: raw.database,
    services: raw.services ?? DEFAULTS.services,
    plugins,
  };
}
