export { defineConfig } from "./config.js";
export { dns, caddy, serviceEnv, defaultPlugins, copyFiles, shell, postgres, redis, ports, direnv } from "./plugins.js";
export type { CopyFilesOptions, ShellOptions, PortsPlugin, DirenvOptions, RedisConfig } from "./plugins.js";
export type { Plugin, PluginContext, WtenvConfig, ServiceConfig, ProjectConfig, ProjectDomain, DatabaseConfig, } from "./config.js";
