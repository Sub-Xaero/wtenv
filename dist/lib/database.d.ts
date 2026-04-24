export interface DatabaseConfig {
    namePattern: string;
    host: string;
    port: number;
    username: string;
    password: string;
    envVar: string;
    forkFrom?: string;
}
export declare function provisionDatabase(worktreeName: string, config: DatabaseConfig): string;
export declare function teardownDatabase(worktreeName: string, config: DatabaseConfig): void;
export declare function buildDatabaseUrl(worktreeName: string, config: DatabaseConfig): string;
