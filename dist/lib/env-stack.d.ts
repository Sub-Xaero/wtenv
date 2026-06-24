export interface EnvStackOptions {
    cwd?: string;
    envFile?: string;
}
export interface LoadedEnvStack {
    cwd: string;
    layers: string[];
    present: string[];
    merged: Record<string, string>;
    source: Record<string, string>;
}
export declare function loadEnvStack(options?: EnvStackOptions): LoadedEnvStack;
export declare function composeEnvStack(options?: EnvStackOptions): NodeJS.ProcessEnv;
