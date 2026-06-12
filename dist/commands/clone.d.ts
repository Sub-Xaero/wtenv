interface CloneOptions {
    envFile?: string;
}
export declare function clone(branch: string, pathOverride: string | undefined, opts?: CloneOptions): Promise<void>;
export {};
