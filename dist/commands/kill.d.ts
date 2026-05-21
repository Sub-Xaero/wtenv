interface KillOptions {
    cwd?: string;
    configRoot?: string;
    force?: boolean;
    dryRun?: boolean;
}
interface ProjectKillOptions {
    configRoot?: string;
    force?: boolean;
    dryRun?: boolean;
}
export declare function kill(opts?: KillOptions): Promise<void>;
export declare function projectKill(opts?: ProjectKillOptions): Promise<void>;
export {};
