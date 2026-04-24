interface ProjectOptions {
    configRoot?: string;
}
export declare function projectRegister(opts?: ProjectOptions): Promise<void>;
export declare function projectDeregister(opts?: ProjectOptions): Promise<void>;
export {};
