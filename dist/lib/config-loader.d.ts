interface InitData {
    wtenvUrl: string;
}
interface ResolveContext {
    parentURL?: string;
    conditions: string[];
    importAttributes: Record<string, string>;
}
interface ResolveResult {
    url: string;
    format?: string | null;
    shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context?: ResolveContext) => Promise<ResolveResult>;
export declare function initialize(data: InitData): Promise<void>;
export declare function resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve): Promise<ResolveResult>;
export {};
