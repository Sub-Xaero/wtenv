interface ReregisterOptions {
    cwd?: string;
    configRoot?: string;
    envFile?: string;
    keepName?: boolean;
}
export declare function reregister(name: string | undefined, opts?: ReregisterOptions): Promise<void>;
export {};
