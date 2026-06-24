interface SlugOptions {
    json?: boolean;
}
interface RenameSlugOptions {
    cwd?: string;
    configRoot?: string;
    envFile?: string;
}
export declare function listSlugs(options?: SlugOptions): void;
export declare function renameSlug(slug: string, options?: RenameSlugOptions): Promise<void>;
export {};
