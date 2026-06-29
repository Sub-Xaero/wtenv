import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.HOME = mkdtempSync(join(tmpdir(), "wtenv-plugins-home-"));

const {
  copyFiles,
  direnv,
  ports,
  serviceEnv,
  shell,
} = await import("../dist/lib/plugins.js");

function tempDir(prefix = "wtenv-plugins-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function baseContext(overrides = {}) {
  const cwd = tempDir();
  return {
    worktreeId: `id-${Math.random()}`,
    worktreeName: "feature-x",
    slug: "otter",
    cwd,
    configRoot: cwd,
    gitRoot: cwd,
    ports: {},
    envVars: {},
    config: {
      tld: "test",
      services: {},
      aliases: undefined,
      project: undefined,
      database: undefined,
    },
    ...overrides,
  };
}

test("serviceEnv expands service templates for root, subdomain, and disabled hostnames", () => {
  const ctx = baseContext({
    ports: { web: 3000, api: 3001, worker: 3002 },
    config: {
      tld: "test",
      services: {
        web: {
          hostname: "*",
          env: {
            PORT: "{port}",
            APP_URL: "https://{fqdn}",
            WORKTREE: "{worktree}",
          },
        },
        api: {
          hostname: "api",
          env: {
            API_URL: "https://{fqdn}",
            API_HOST: "{hostname}",
          },
        },
        worker: {
          hostname: false,
          env: {
            WORKER_PORT: "{port}",
            WORKER_FQDN: "{fqdn}",
          },
        },
        missingPort: {
          hostname: "missing",
          env: {
            MISSING: "{port}",
          },
        },
      },
    },
  });

  serviceEnv().onRegister(ctx);

  assert.deepEqual(ctx.envVars, {
    PORT: "3000",
    APP_URL: "https://otter.test",
    WORKTREE: "feature-x",
    API_URL: "https://api.otter.test",
    API_HOST: "api",
    WORKER_PORT: "3002",
    WORKER_FQDN: "otter.test",
  });
});

test("direnv writes and removes .envrc with the configured dotenv stack", () => {
  const ctx = baseContext();
  const plugin = direnv({ envFile: ".env.preview" });

  plugin.onRegister(ctx);

  assert.equal(
    readFileSync(join(ctx.cwd, ".envrc"), "utf8"),
    "dotenv_if_exists .env\ndotenv_if_exists .env.local\ndotenv_if_exists .env.preview\n",
  );

  plugin.onDeregister(ctx);

  assert.equal(existsSync(join(ctx.cwd, ".envrc")), false);
});

test("copyFiles copies files, creates symlinks, skips optional files, and removes only its symlinks", () => {
  const gitRoot = tempDir("wtenv-copy-source-");
  const cwd = tempDir("wtenv-copy-dest-");
  writeFileSync(join(gitRoot, "required.txt"), "required");
  writeFileSync(join(gitRoot, "shared.txt"), "shared");

  const plugin = copyFiles({
    files: [
      "required.txt",
      { src: "missing.txt", optional: true },
      { src: "shared.txt", dest: "links/shared.txt", symlink: true },
    ],
  });
  const ctx = baseContext({ gitRoot, cwd });

  plugin.onRegister(ctx);

  assert.equal(readFileSync(join(cwd, "required.txt"), "utf8"), "required");
  const linkPath = join(cwd, "links/shared.txt");
  assert.equal(lstatSync(linkPath).isSymbolicLink(), true);
  assert.equal(readFileSync(linkPath, "utf8"), "shared");
  assert.equal(existsSync(join(cwd, "missing.txt")), false);

  plugin.onDeregister(ctx);

  assert.equal(existsSync(linkPath), false);
  assert.equal(readFileSync(join(cwd, "required.txt"), "utf8"), "required");
});

test("copyFiles leaves existing symlink destinations untouched", () => {
  const gitRoot = tempDir("wtenv-copy-source-");
  const cwd = tempDir("wtenv-copy-dest-");
  writeFileSync(join(gitRoot, "shared.txt"), "shared");
  writeFileSync(join(cwd, "shared-link.txt"), "existing file");

  const plugin = copyFiles({
    files: [{ src: "shared.txt", dest: "shared-link.txt", symlink: true }],
  });
  const ctx = baseContext({ gitRoot, cwd });

  plugin.onRegister(ctx);
  plugin.onDeregister(ctx);

  assert.equal(readFileSync(join(cwd, "shared-link.txt"), "utf8"), "existing file");
});

test("copyFiles seeds from gitRoot even when configRoot collapses onto the worktree", () => {
  // Worktree carries its own committed .wtenv.config.js, so configRoot === cwd.
  // copy-files must still copy from the main checkout (gitRoot), not no-op.
  const gitRoot = tempDir("wtenv-copy-source-");
  const cwd = tempDir("wtenv-copy-dest-");
  writeFileSync(join(gitRoot, "master.key"), "key123");

  const plugin = copyFiles({ files: ["master.key"] });
  const ctx = baseContext({ gitRoot, configRoot: cwd, cwd });

  plugin.onRegister(ctx);

  assert.equal(readFileSync(join(cwd, "master.key"), "utf8"), "key123");
});

test("copyFiles honors a 'from' override for an alternate source directory", () => {
  const gitRoot = tempDir("wtenv-copy-source-");
  const cwd = tempDir("wtenv-copy-dest-");
  mkdirSync(join(gitRoot, "secrets"), { recursive: true });
  writeFileSync(join(gitRoot, "secrets", "token.txt"), "from-secrets");

  const plugin = copyFiles({ from: "secrets", files: ["token.txt"] });
  const ctx = baseContext({ gitRoot, configRoot: cwd, cwd });

  plugin.onRegister(ctx);

  assert.equal(readFileSync(join(cwd, "token.txt"), "utf8"), "from-secrets");
});

test("copyFiles skips when the resolved source equals cwd (registering the main checkout)", () => {
  const cwd = tempDir("wtenv-copy-main-");
  writeFileSync(join(cwd, "self.txt"), "self");

  const plugin = copyFiles({ files: ["self.txt"] });
  // gitRoot === cwd happens when you register the main checkout itself.
  const ctx = baseContext({ gitRoot: cwd, configRoot: cwd, cwd });

  // Must not throw or try to copy a file onto itself.
  plugin.onRegister(ctx);
  assert.equal(readFileSync(join(cwd, "self.txt"), "utf8"), "self");
});

test("ports plugin allocates slug, ports, and generated domain env vars", () => {
  const ctx = baseContext({
    worktreeId: "plugin-ports-a",
    worktreeName: "ports-app",
    cwd: "/tmp/ports-app",
    config: {
      tld: "test",
      services: {
        web: { hostname: "*" },
        api: { hostname: "api" },
      },
    },
  });

  ports({ portRange: [4500, 4502], slug: "stoat" }).onRegister(ctx);

  assert.equal(ctx.slug, "stoat");
  assert.deepEqual(ctx.ports, { web: 4500, api: 4501 });
  assert.equal(ctx.envVars.WTENV_SLUG, "stoat");
  assert.equal(ctx.envVars.WTENV_DOMAIN, "stoat.test");
});

test("shell commands see .env, .env.local, and generated env vars in precedence order", () => {
  const cwd = tempDir();
  const outputPath = join(cwd, "shell-output.txt");
  writeFileSync(join(cwd, ".env"), "VALUE=base\nBASE_ONLY=yes\n");
  writeFileSync(join(cwd, ".env.local"), "VALUE=local\n");

  const ctx = baseContext({
    cwd,
    envVars: {
      VALUE: "generated",
      GENERATED_ONLY: "yes",
      OUTPUT_PATH: outputPath,
    },
  });

  shell({
    onRegister: [
      "node -e \"require('node:fs').writeFileSync(process.env.OUTPUT_PATH, [process.env.VALUE, process.env.BASE_ONLY, process.env.GENERATED_ONLY].join(','))\"",
    ],
  }).onRegister(ctx);

  assert.equal(readFileSync(outputPath, "utf8"), "generated,yes,yes");
});
