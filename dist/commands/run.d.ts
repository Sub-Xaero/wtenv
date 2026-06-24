interface RunOptions {
    cwd?: string;
    envFile?: string;
}
export declare function run(command: string[], options?: RunOptions): void;
export {};
