export declare function provisionRedis(slug: string, dbIndex: number, opts?: {
    host?: string;
    port?: number;
}): string;
export declare function teardownRedis(slug: string, dbIndex: number, opts?: {
    host?: string;
    port?: number;
    flushOnDeregister?: boolean;
}): void;
