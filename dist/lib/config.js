import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const DEFAULTS = {
    portRange: [3100, 4099],
    tld: "test",
    services: {
        web: { envVar: "PORT", hostname: "*" },
    },
};
export function loadConfig(cwd = process.cwd()) {
    const configPath = join(cwd, ".wtenv.json");
    if (!existsSync(configPath))
        return DEFAULTS;
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    return {
        portRange: raw.portRange ?? DEFAULTS.portRange,
        tld: raw.tld ?? DEFAULTS.tld,
        project: raw.project,
        database: raw.database,
        services: raw.services ?? DEFAULTS.services,
    };
}
