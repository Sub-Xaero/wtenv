// ESM loader hook that resolves the bare specifier "wtenv" to wtenv's own
// exports.js. Lets `.wtenv.config.js` files do `import ... from "wtenv"`
// without the consuming project needing wtenv in node_modules / package.json.
let wtenvUrl;
export async function initialize(data) {
    wtenvUrl = data.wtenvUrl;
}
export async function resolve(specifier, context, nextResolve) {
    if (specifier === "wtenv" && wtenvUrl) {
        return { url: wtenvUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
