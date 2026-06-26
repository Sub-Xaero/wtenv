import type { DatabaseConfig } from "./config.js";
export type { DatabaseConfig };
export declare function provisionDatabase(slug: string, config: DatabaseConfig): Promise<string>;
export declare function teardownDatabase(slug: string, config: DatabaseConfig): Promise<void>;
export declare function buildDatabaseUrl(slug: string, config: DatabaseConfig): string;
