import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { success, info, error } from "../lib/log.js";

export type InitPreset = "auto" | "node" | "next" | "rails";

export function detectProjectName(cwd: string): string | null {
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

function buildDefaultConfig(projectName: string | null, withPostgres: boolean): string {
  const nameComment = projectName ? `  // Project: ${projectName}\n` : "";

  const postgresBlock = withPostgres
    ? `
  // Uncomment and configure if you use PostgreSQL:
  // postgres({
  //   namePattern: "${projectName ?? "myapp"}_{slug}",
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
  // hostname "*" = root domain (slug.test); use a string for a subdomain (api.slug.test).
  // Env var values support: {port} {worktree} {slug} {tld} {hostname} {domain} {fqdn}
  //   {slug}=animal label  {domain}=slug.tld  {fqdn}=hostname.slug.tld
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

function buildNodePreset(projectName: string | null): string {
  const nameComment = projectName ? `  // Project: ${projectName}\n` : "";
  return `import { defineConfig, defaultPlugins, direnv } from "wtenv";

export default defineConfig({
${nameComment}  tld: "test",

  services: {
    web: {
      hostname: "*",
      env: {
        PORT: "{port}",
        APP_URL: "https://{domain}",
      },
    },
  },

  plugins: [
    ...defaultPlugins({ portRange: [3000, 3999] }),
    direnv(),
  ],
});
`;
}

function buildNextPreset(projectName: string | null): string {
  const nameComment = projectName ? `  // Project: ${projectName}\n` : "";
  return `import { defineConfig, defaultPlugins, direnv } from "wtenv";

export default defineConfig({
${nameComment}  tld: "test",

  services: {
    web: {
      hostname: "*",
      env: {
        PORT: "{port}",
        NEXT_PUBLIC_APP_URL: "https://{domain}",
      },
    },
  },

  plugins: [
    ...defaultPlugins({ portRange: [3000, 3999] }),
    direnv(),
  ],
});
`;
}

function buildRailsPreset(projectName: string | null): string {
  const app = projectName ?? "myapp";
  return `import { defineConfig, defaultPlugins, copyFiles, direnv, postgres, redis, shell } from "wtenv";

export default defineConfig({
  // Project: ${app}
  tld: "test",

  services: {
    web: {
      hostname: "*",
      env: {
        PORT: "{port}",
        APP_DOMAIN: "{domain}",
        APP_URL: "https://{domain}",
      },
    },
    vite: {
      hostname: "assets",
      env: {
        VITE_RUBY_PORT: "{port}",
        VITE_HMR_HOST: "{fqdn}",
      },
    },
  },

  plugins: [
    ...defaultPlugins({ portRange: [3100, 4099] }),
    copyFiles({
      files: [
        { src: "config/master.key", optional: true },
        { src: "config/database.yml", optional: true },
        { src: "storage", optional: true, symlink: true },
      ],
    }),
    postgres({
      namePattern: "${app}_development_{slug}",
      forkFrom: "${app}_development",
      host: "localhost",
      port: 5432,
      username: "postgres",
      password: "postgres",
      envVar: "DATABASE_URL",
    }),
    redis(),
    direnv(),
    shell({
      onRegister: [
        "bundle install",
        "bundle exec rails db:migrate",
      ],
    }),
  ],
});
`;
}

function buildConfig(projectName: string | null, withPostgres: boolean, preset: InitPreset): string {
  switch (preset) {
    case "node":
      return buildNodePreset(projectName);
    case "next":
      return buildNextPreset(projectName);
    case "rails":
      return buildRailsPreset(projectName);
    case "auto":
      return buildDefaultConfig(projectName, withPostgres);
  }
}

export function init(options: { force?: boolean; cwd?: string; preset?: InitPreset } = {}): void {
  const cwd = options.cwd ?? process.cwd();
  const outPath = join(cwd, ".wtenv.config.js");

  if (existsSync(outPath) && !options.force) {
    error(".wtenv.config.js already exists. Use --force to overwrite.");
    process.exit(1);
  }

  const projectName = detectProjectName(cwd);
  const withPostgres = hasPostgresDep(cwd);
  const preset = options.preset ?? "auto";

  writeFileSync(outPath, buildConfig(projectName, withPostgres, preset));

  success(`Created .wtenv.config.js${projectName ? ` for project "${projectName}"` : ""}`);
  if (preset !== "auto") {
    info(`preset: ${preset}`);
  } else if (withPostgres) {
    info("detected Postgres dependency — postgres() plugin snippet included (commented out)");
  }
  console.log();
  console.log("Next steps:");
  console.log("  1. Review and edit .wtenv.config.js");
  console.log("  2. Run wtenv register to create a worktree environment");
}
