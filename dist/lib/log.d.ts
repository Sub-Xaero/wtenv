type LogStream = "stdout" | "stderr";
export type CapturedResult<T> = {
    ok: true;
    result: T;
    output: string;
} | {
    ok: false;
    error: unknown;
    output: string;
};
export declare const c: {
    bold: (s: string) => string;
    dim: (s: string) => string;
    red: (s: string) => string;
    green: (s: string) => string;
    yellow: (s: string) => string;
    cyan: (s: string) => string;
};
export declare function captureLogs<T>(fn: () => Promise<T> | T): Promise<CapturedResult<T>>;
export declare function appendCapturedLog(text: string, stream?: LogStream): void;
export declare function flushCapturedLog(output: string): void;
export declare function header(text: string): void;
export declare function step(text: string): void;
export declare function info(text: string): void;
export declare function cmd(text: string): void;
export declare function success(text: string): void;
export declare function warn(text: string): void;
export declare function error(text: string): void;
export {};
