interface DeregisterOptions {
    cwd?: string;
    configRoot?: string;
    envFile?: string;
    id?: string;
    slug?: string;
}
export declare function deregister(name: string | undefined, opts?: DeregisterOptions): Promise<void>;
export declare function deregisterStale(opts?: {
    envFile?: string;
}): Promise<void>;
export {};
