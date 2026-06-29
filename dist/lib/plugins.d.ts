import type { Plugin, DatabaseConfig } from "./config.js";
import type { PlanInput } from "./plan.js";
export interface PortsPlugin extends Plugin {
    portRange: [number, number];
    slugHint?: string;
}
export declare function ports(options?: {
    portRange?: [number, number];
    slug?: string;
}): PortsPlugin;
export declare function dns(): Plugin;
export declare function caddy(): Plugin;
export declare function serviceEnv(): Plugin;
export declare function defaultPlugins(opts?: {
    portRange?: [number, number];
}): Plugin[];
export interface CopyFilesEntry {
    src: string;
    dest?: string;
    optional?: boolean;
    symlink?: boolean;
}
export interface CopyFilesOptions {
    files: Array<string | CopyFilesEntry>;
    from?: string;
    label?: string;
}
export declare function copyFiles(options: CopyFilesOptions): Plugin;
export interface ShellOptions {
    onRegister?: PlanInput<string>;
    onDeregister?: PlanInput<string>;
    label?: string;
}
export declare function shell(options: ShellOptions): Plugin;
export declare const DOTENV_LAYERS: readonly [".env", ".env.local"];
export interface DirenvOptions {
    envFile?: string;
}
export declare function direnv(options?: DirenvOptions): Plugin;
export declare function postgres(options: DatabaseConfig): Plugin;
export interface RedisConfig {
    envVar?: string;
    host?: string;
    port?: number;
    flushOnDeregister?: boolean;
    dbStart?: number;
    dbEnd?: number;
}
export declare function redis(options?: RedisConfig): Plugin;
