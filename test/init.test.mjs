import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { detectProjectName, init } from "../dist/commands/init.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "wtenv-init-"));
}

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = "";
  process.stdout.write = function write(chunk, ...args) {
    output += String(chunk);
    const cb = args.find((arg) => typeof arg === "function");
    if (cb) cb();
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
}

test("detectProjectName prefers package.json name and strips npm scope", () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@acme/web-app" }));

  assert.equal(detectProjectName(cwd), "web-app");
});

test("detectProjectName falls back to the git origin repository name", () => {
  const cwd = tempDir();
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/bozeman.git"], {
    cwd,
    stdio: "ignore",
  });

  assert.equal(detectProjectName(cwd), "bozeman");
});

test("init node preset writes a config with node defaults and next steps", () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@acme/web-app" }));

  const output = captureStdout(() => init({ cwd, preset: "node" }));
  const config = readFileSync(join(cwd, ".wtenv.config.js"), "utf8");

  assert.match(config, /import \{ defineConfig, defaultPlugins, direnv \} from "wtenv";/);
  assert.match(config, /\/\/ Project: web-app/);
  assert.match(config, /APP_URL: "https:\/\/\{domain\}"/);
  assert.match(config, /\.\.\.defaultPlugins\(\{ portRange: \[3000, 3999\] \}\)/);
  assert.match(config, /direnv\(\)/);
  assert.match(output, /Created \.wtenv\.config\.js for project "web-app"/);
  assert.match(output, /preset: node/);
  assert.match(output, /Run wtenv register to create a worktree environment/);
});

test("init auto preset includes a commented postgres snippet when postgres dependencies are present", () => {
  const cwd = tempDir();
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "api",
      dependencies: {
        prisma: "^6.0.0",
      },
    }),
  );

  const output = captureStdout(() => init({ cwd, preset: "auto" }));
  const config = readFileSync(join(cwd, ".wtenv.config.js"), "utf8");

  assert.match(config, /\/\/ postgres\(\{/);
  assert.match(config, /\/\/   namePattern: "api_\{slug\}"/);
  assert.match(config, /\/\/   envVar: "DATABASE_URL"/);
  assert.match(output, /detected Postgres dependency/);
});

test("init rails preset writes Rails services and database helpers", () => {
  const cwd = tempDir();

  init({ cwd, preset: "rails" });
  const config = readFileSync(join(cwd, ".wtenv.config.js"), "utf8");

  assert.match(config, /import \{ defineConfig, defaultPlugins, copyFiles, direnv, postgres, redis, shell \} from "wtenv";/);
  assert.match(config, /vite: \{/);
  assert.match(config, /VITE_HMR_HOST: "\{fqdn\}"/);
  assert.match(config, /copyFiles\(\{/);
  assert.match(config, /postgres\(\{/);
  assert.match(config, /redis\(\)/);
  assert.match(config, /bundle exec rails db:migrate/);
});
