import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

function detectProjectName(cwd: string): string | null {
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (typeof pkg.name === "string" && pkg.name) {
        // Strip scope and use the bare name
        return pkg.name.replace(/^@[^/]+\//, "");
      }
    } catch {}
  }

  try {
    const remote = execSync("git remote get-url origin", { cwd, stdio: "pipe" }).toString().trim();
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch {}

  return null;
}

function hasPostgresDep(cwd: string): boolean {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(allDeps).some((d) => /pg|postgres|prisma|sequelize|knex|drizzle/.test(d));
  } catch {
    return false;
  }
}

function buildConfig(projectName: string | null, withPostgres: boolean): string {
  const nameComment = projectName ? `  // Project: ${projectName}\n` : "";

  const postgresBlock = withPostgres
    ? `
  // Uncomment and configure if you use PostgreSQL:
  // postgres({
  //   namePattern: "${projectName ?? "myapp"}_{worktree}",
  //   host: "localhost",
  //   port: 5432,
  //   username: "postgres",
  //   password: "postgres",
  //   envVar: "DATABASE_URL",
  // }),`
    : "";

  return `import { defineConfig, defaultPlugins } from "wtenv";
// import { postgres } from "wtenv";

export default defineConfig({
${nameComment}  tld: "test",

  // Map service names to hostnames and env vars.
  // hostname "*" = root domain (worktree.test); use a string for a subdomain (api.worktree.test).
  // Env var values support: {port} {worktree} {tld} {hostname} {domain} {fqdn}
  services: {
    web: {
      hostname: "*",
      env: {
        PORT: "{port}",
      },
    },
    // api: {
    //   hostname: "api",
    //   env: {
    //     PORT: "{port}",
    //     API_URL: "https://{fqdn}",
    //   },
    // },
  },

  plugins: [
    ...defaultPlugins(),
    // defaultPlugins() includes: ports, dns, caddy, serviceEnv
    // Pass options to customise the port range:
    // ...defaultPlugins({ portRange: [4000, 4999] }),
${postgresBlock}
  ],
});
`;
}

export function init(options: { force?: boolean; cwd?: string } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const outPath = join(cwd, ".wtenv.config.js");

  if (existsSync(outPath) && !options.force) {
    console.error(`.wtenv.config.js already exists. Use --force to overwrite.`);
    process.exit(1);
  }

  const projectName = detectProjectName(cwd);
  const withPostgres = hasPostgresDep(cwd);

  writeFileSync(outPath, buildConfig(projectName, withPostgres));

  console.log(`Created .wtenv.config.js${projectName ? ` for project "${projectName}"` : ""}`);
  if (withPostgres) {
    console.log("  Detected Postgres dependency — postgres() plugin snippet included (commented out).");
  }
  console.log("\nNext steps:");
  console.log("  1. Review and edit .wtenv.config.js");
  console.log("  2. Run wtenv register to create a worktree environment");
}
