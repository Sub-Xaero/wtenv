export declare function installSudoers(): Promise<void>;
export interface SetupOptions {
    installSudoers?: boolean;
}
export declare function setup(opts?: SetupOptions): Promise<void>;
