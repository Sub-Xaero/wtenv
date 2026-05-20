export interface Worktree {
    id: string;
    name: string;
    city: string;
    project_root: string;
    created_at: number;
}
export interface PortAssignment {
    worktree_id: string;
    service_name: string;
    port: number;
}
export interface AllocateOptions {
    cityHint?: string;
}
export interface AllocationResult {
    city: string;
    ports: Record<string, number>;
}
export declare function allocateWorktree(id: string, name: string, projectRoot: string, services: string[], portRange: [number, number], options?: AllocateOptions): AllocationResult;
export declare function releaseWorktree(id: string): void;
export declare function getWorktree(id: string): Worktree | null;
export declare function getWorktreePorts(id: string): Record<string, number>;
export declare function listWorktrees(): Array<Worktree & {
    ports: Record<string, number>;
}>;
export declare function isRegistered(id: string): boolean;
