export interface Worktree {
    id: string;
    name: string;
    slug: string;
    project_root: string;
    created_at: number;
}
export interface PortAssignment {
    worktree_id: string;
    service_name: string;
    port: number;
}
export interface AllocateOptions {
    slugHint?: string;
}
export declare function validateSlug(slug: string): void;
export interface AllocationResult {
    slug: string;
    ports: Record<string, number>;
}
export declare function allocateWorktree(id: string, name: string, projectRoot: string, services: string[], portRange: [number, number], options?: AllocateOptions): AllocationResult;
export declare function releaseWorktree(id: string): void;
export declare function renameWorktreeSlug(id: string, slug: string): void;
export declare function getWorktree(id: string): Worktree | null;
export declare function getWorktreeBySlug(slug: string): Worktree | null;
export declare function getWorktreePorts(id: string): Record<string, number>;
export declare function listWorktrees(): Array<Worktree & {
    ports: Record<string, number>;
}>;
export declare function isRegistered(id: string): boolean;
export declare function allocateRedisDb(worktreeId: string, opts?: {
    dbStart?: number;
    dbEnd?: number;
}): number;
export declare function getRedisDb(worktreeId: string): number | null;
export declare function releaseRedisDb(worktreeId: string): void;
