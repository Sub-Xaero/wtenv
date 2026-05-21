interface OpenOptions {
    cwd?: string;
    configRoot?: string;
    print?: boolean;
}
interface ProjectOpenOptions {
    configRoot?: string;
    print?: boolean;
}
export declare function open(arg: string | undefined, opts?: OpenOptions): Promise<void>;
export declare function projectOpen(arg: string | undefined, opts?: ProjectOpenOptions): Promise<void>;
export {};
