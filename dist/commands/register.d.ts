interface RegisterOptions {
    cwd?: string;
    configRoot?: string;
    envFile?: string;
    dryRun?: boolean;
}
export declare function register(worktreeName: string, opts?: RegisterOptions): Promise<void>;
export {};
