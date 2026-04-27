interface RegisterOptions {
    cwd?: string;
    configRoot?: string;
    envFile?: string;
    dryRun?: boolean;
}
export declare function register(name: string | undefined, opts?: RegisterOptions): Promise<void>;
export {};
