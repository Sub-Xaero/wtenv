export interface ServiceConfig {
    envVar: string;
    hostname: string;
}
export interface WsproxyConfig {
    portRange: [number, number];
    tld: string;
    services: Record<string, ServiceConfig>;
}
export declare function loadConfig(cwd?: string): WsproxyConfig;
