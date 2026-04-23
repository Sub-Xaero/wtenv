export declare function registerCaddy(worktreeName: string, tld: string, ports: Record<string, number>, serviceHostnames: Record<string, string>): Promise<void>;
export declare function deregisterCaddy(worktreeName: string): Promise<void>;
export declare function isCaddyRunning(): Promise<boolean>;
