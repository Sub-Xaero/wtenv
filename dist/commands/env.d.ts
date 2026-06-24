export interface EnvCommandOptions {
    cwd?: string;
    envFile?: string;
    json?: boolean;
}
export declare function envExport(options?: EnvCommandOptions): void;
export declare function envUnset(options?: EnvCommandOptions): void;
export declare function envShow(options?: EnvCommandOptions): void;
