export { defineConfig } from "./config.js";
export { dns, caddy, serviceEnv, defaultPlugins, copyFiles, shell, postgres, ports } from "./plugins.js";
export type { CopyFilesOptions, ShellOptions, PortsPlugin } from "./plugins.js";
export type {
  Plugin,
  PluginContext,
  WtenvConfig,
  ServiceConfig,
  ProjectConfig,
  ProjectDomain,
  DatabaseConfig,
} from "./config.js";
