import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { defineConfig, loadConfig } from "../dist/lib/config.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "wtenv-config-"));
}

test("loadConfig returns default config when no config file exists", async () => {
  const config = await loadConfig(tempDir());

  assert.equal(config.tld, "test");
  assert.deepEqual(config.services, {
    web: { hostname: "*", env: { PORT: "{port}" } },
  });
  assert.deepEqual(
    config.plugins.map((plugin) => plugin.name),
    ["wtenv:ports", "wtenv:dns", "wtenv:caddy", "wtenv:service-env"],
  );
});

test("loadConfig normalizes JSON config and injects infrastructure plugins", async () => {
  const cwd = tempDir();
  writeFileSync(
    join(cwd, ".wtenv.json"),
    JSON.stringify({
      tld: "localhost",
      portRange: [4200, 4202],
      services: {
        web: { hostname: "*", env: { PORT: "{port}", APP_URL: "https://{domain}" } },
        api: { hostname: "api", env: { API_URL: "https://{fqdn}" } },
      },
      database: {
        namePattern: "app_{slug}",
        host: "localhost",
        port: 5432,
        username: "postgres",
        password: "postgres",
        envVar: "DATABASE_URL",
      },
      aliases: {
        admin: "admin",
      },
    }),
  );

  const config = await loadConfig(cwd);

  assert.equal(config.tld, "localhost");
  assert.equal(config.services.api.hostname, "api");
  assert.deepEqual(config.aliases, { admin: "admin" });
  assert.deepEqual(
    config.plugins.map((plugin) => plugin.name),
    ["wtenv:ports", "wtenv:dns", "wtenv:caddy", "wtenv:service-env", "wtenv:postgres"],
  );
  assert.deepEqual(config.plugins[0].portRange, [4200, 4202]);
});

test("defineConfig preserves explicit plugins and fills an omitted plugin list", () => {
  const explicitPlugin = { name: "custom" };

  assert.deepEqual(
    defineConfig({
      tld: "test",
      services: {},
      plugins: [explicitPlugin],
    }).plugins,
    [explicitPlugin],
  );

  assert.deepEqual(
    defineConfig({
      tld: "test",
      services: {},
    }).plugins,
    [],
  );
});
