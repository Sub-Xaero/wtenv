export type CurrentFormat = "readable" | "short" | "json";
interface CurrentOptions {
    cwd?: string;
    configRoot?: string;
    format?: CurrentFormat;
}
export declare function current(options?: CurrentOptions): Promise<void>;
export {};
