export type SudoState = "available" | "cached" | "needs-password" | "no-sudo";
export declare function sudoState(): SudoState;
export declare function canSudoSilently(): boolean;
export declare function requireSudoOrSkip(reason: string): boolean;
export declare function sudoExec(argv: string[], opts?: {
    stdio?: "inherit" | "ignore" | "pipe";
}): boolean;
export declare function primeSudoCache(): NodeJS.Timeout | null;
