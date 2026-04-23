export interface Worktree {
    name: string;
    project_root: string;
    created_at: number;
}
export interface PortAssignment {
    worktree_name: string;
    service_name: string;
    port: number;
}
export declare function allocatePorts(worktreeName: string, projectRoot: string, services: string[], portRange: [number, number]): Record<string, number>;
export declare function releasePorts(worktreeName: string): void;
export declare function getWorktreePorts(worktreeName: string): Record<string, number>;
export declare function listWorktrees(): Array<Worktree & {
    ports: Record<string, number>;
}>;
export declare function isRegistered(worktreeName: string): boolean;
