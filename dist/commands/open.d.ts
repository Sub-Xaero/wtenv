interface OpenOptions {
    cwd?: string;
    configRoot?: string;
    print?: boolean;
    wait?: boolean;
    waitAsync?: boolean;
    timeout?: number;
}
interface ProjectOpenOptions {
    configRoot?: string;
    print?: boolean;
    wait?: boolean;
    waitAsync?: boolean;
    timeout?: number;
}
export declare function open(arg: string | undefined, opts?: OpenOptions): Promise<void>;
export declare function projectOpen(arg: string | undefined, opts?: ProjectOpenOptions): Promise<void>;
export {};
