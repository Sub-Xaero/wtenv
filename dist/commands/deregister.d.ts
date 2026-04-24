interface DeregisterOptions {
    cwd?: string;
    configRoot?: string;
    envFile?: string;
}
export declare function deregister(worktreeName: string, opts?: DeregisterOptions): Promise<void>;
export {};
