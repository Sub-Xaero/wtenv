import * as readline from "node:readline/promises";
// Y/N prompt with N as the default. Returns false immediately when stdin/stdout
// aren't TTYs so commands stay safe in non-interactive runs (CI, piped scripts).
export async function promptYN(question) {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
        return false;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
        return answer === "y" || answer === "yes";
    }
    finally {
        rl.close();
    }
}
