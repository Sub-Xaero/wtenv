export type InitPreset = "auto" | "node" | "next" | "rails";
export declare function detectProjectName(cwd: string): string | null;
export declare function init(options?: {
    force?: boolean;
    cwd?: string;
    preset?: InitPreset;
}): void;
