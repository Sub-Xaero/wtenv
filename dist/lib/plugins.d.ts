import type { Plugin, DatabaseConfig } from "./config.js";
export interface PortsPlugin extends Plugin {
    portRange: [number, number];
}
export declare function ports(options?: {
    portRange?: [number, number];
}): PortsPlugin;
export declare function dns(): Plugin;
export declare function caddy(): Plugin;
export declare function serviceEnv(): Plugin;
export declare function defaultPlugins(opts?: {
    portRange?: [number, number];
}): Plugin[];
export interface CopyFilesOptions {
    files: Array<string | {
        src: string;
        dest?: string;
        optional?: boolean;
    }>;
}
export declare function copyFiles(options: CopyFilesOptions): Plugin;
export interface ShellOptions {
    onRegister?: string[];
    onDeregister?: string[];
}
export declare function shell(options: ShellOptions): Plugin;
export interface DirenvOptions {
    envFile?: string;
}
export declare function direnv(options?: DirenvOptions): Plugin;
export declare function postgres(options: DatabaseConfig): Plugin;
