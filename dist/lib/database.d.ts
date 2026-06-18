import type { DatabaseConfig } from "./config.js";
export type { DatabaseConfig };
export declare function provisionDatabase(slug: string, config: DatabaseConfig): string;
export declare function teardownDatabase(slug: string, config: DatabaseConfig): void;
export declare function buildDatabaseUrl(slug: string, config: DatabaseConfig): string;
