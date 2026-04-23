interface DeregisterOptions {
    cwd?: string;
    envFile?: string;
}
export declare function deregister(worktreeName: string, opts?: DeregisterOptions): Promise<void>;
export {};
