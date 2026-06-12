export declare function registerDnsmasq(worktreeName: string, tld: string): void;
export declare function deregisterDnsmasq(worktreeName: string, tld?: string): void;
export declare function registerProjectDnsmasq(projectName: string, baseDomain: string): void;
export declare function deregisterProjectDnsmasq(projectName: string, baseDomain: string): void;
export declare function hasDnsmasqConf(worktreeName: string): boolean;
export declare function listDnsmasqConfNames(): string[];
export declare function isDnsmasqRunning(): boolean;
