export declare function registerDnsmasq(slug: string, tld: string): void;
export declare function deregisterDnsmasq(slug: string, tld?: string): void;
export declare function registerProjectDnsmasq(projectName: string, baseDomain: string): void;
export declare function deregisterProjectDnsmasq(projectName: string, baseDomain: string): void;
export declare function hasDnsmasqConf(slug: string): boolean;
export declare function listDnsmasqConfNames(): string[];
export declare function isDnsmasqRunning(): boolean;
