interface DeregisterOptions {
    cwd?: string;
    configRoot?: string;
    envFile?: string;
}
export declare function deregister(name: string | undefined, opts?: DeregisterOptions): Promise<void>;
export {};
