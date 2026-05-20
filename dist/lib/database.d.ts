import type { DatabaseConfig } from "./config.js";
export type { DatabaseConfig };
export declare function provisionDatabase(city: string, config: DatabaseConfig): string;
export declare function teardownDatabase(city: string, config: DatabaseConfig): void;
export declare function buildDatabaseUrl(city: string, config: DatabaseConfig): string;
