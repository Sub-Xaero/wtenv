import type { DatabaseConfig } from "./config.js";
export type { DatabaseConfig };
export declare function provisionDatabase(worktreeName: string, config: DatabaseConfig): string;
export declare function teardownDatabase(worktreeName: string, config: DatabaseConfig): void;
export declare function buildDatabaseUrl(worktreeName: string, config: DatabaseConfig): string;
