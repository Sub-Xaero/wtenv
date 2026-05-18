// ESM loader hook that resolves the bare specifier "wtenv" to wtenv's own
// exports.js. Lets `.wtenv.config.js` files do `import ... from "wtenv"`
// without the consuming project needing wtenv in node_modules / package.json.

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

let wtenvUrl: string | undefined;

export async function initialize(data: InitData): Promise<void> {
  wtenvUrl = data.wtenvUrl;
}

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve
): Promise<ResolveResult> {
  if (specifier === "wtenv" && wtenvUrl) {
    return { url: wtenvUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
