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
    worktreeName: string;
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
export declare function defineConfig(config: Omit<WtenvConfig, "plugins"> & {
    plugins?: Plugin[];
}): WtenvConfig;
export declare function loadConfig(configRoot?: string): Promise<WtenvConfig>;
