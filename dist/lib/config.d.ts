export interface ServiceConfig {
    envVar: string;
    hostname: string;
    hmrHostEnvVar?: string;
    domainEnvVar?: string;
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
}
export interface WsproxyConfig {
    portRange: [number, number];
    tld: string;
    project?: ProjectConfig;
    database?: DatabaseConfig;
    services: Record<string, ServiceConfig>;
}
export declare function loadConfig(cwd?: string): WsproxyConfig;
