interface ReregisterOptions {
    cwd?: string;
    configRoot?: string;
    envFile?: string;
}
export declare function reregister(name: string | undefined, opts?: ReregisterOptions): Promise<void>;
export {};
