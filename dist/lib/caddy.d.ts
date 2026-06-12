import type { ProjectDomain } from "./config.js";
export declare function registerCaddy(worktreeName: string, tld: string, ports: Record<string, number>, serviceHostnames: Record<string, string>): Promise<void>;
export declare function deregisterCaddy(worktreeName: string, tld: string): Promise<void>;
export declare function registerProjectCaddy(projectName: string, domains: ProjectDomain[]): Promise<void>;
export declare function deregisterProjectCaddy(projectName: string, domains: ProjectDomain[]): Promise<void>;
export declare function setListener(ports: string[]): Promise<void>;
export declare function detectCaddyConflict(): string | null;
export declare function hasCaddyRoutes(city: string, tld: string): Promise<boolean>;
export declare function isCaddyRunning(): Promise<boolean>;
