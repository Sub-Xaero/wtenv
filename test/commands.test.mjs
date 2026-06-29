import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.HOME = mkdtempSync(join(tmpdir(), "wtenv-commands-home-"));

const { current } = await import("../dist/commands/current.js");
const { list } = await import("../dist/commands/list.js");
const { open, projectOpen } = await import("../dist/commands/open.js");
const { worktreeId } = await import("../dist/lib/git.js");
const { allocateWorktree, registerProjectRegistration } = await import("../dist/lib/registry.js");

function tempDir(prefix = "wtenv-commands-") {
  return mkdtempSync(join(tmpdir(), prefix));
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
  return Promise.resolve()
    .then(fn)
    .then(
      () => output,
      (err) => {
        throw err;
      },
    )
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

function createRegisteredRepo(slug) {
  const cwd = tempDir();
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(
    join(cwd, ".wtenv.json"),
    JSON.stringify({
      tld: "test",
      services: {
        web: { hostname: "*", env: { PORT: "{port}" } },
        api: { hostname: "api", env: { API_PORT: "{port}" } },
        worker: { hostname: false },
      },
      aliases: {
        admin: "admin-panel",
        api: "alias-api",
      },
    }),
  );

  const id = worktreeId(cwd);
  allocateWorktree(id, `repo-${slug}`, cwd, ["web", "api", "worker"], [5100, 5110], {
    slugHint: slug,
  });

  return { cwd, id };
}

test("current --format json reports domain, ports, URLs, and false hostnames", async () => {
  const { cwd, id } = createRegisteredRepo("otter");

  const output = await captureStdout(() => current({ cwd, format: "json" }));
  const payload = JSON.parse(output);

  assert.equal(payload.id, id);
  assert.equal(payload.name, "repo-otter");
  assert.equal(payload.slug, "otter");
  assert.equal(payload.domain, "otter.test");
  assert.equal(payload.projectRoot, cwd);
  assert.deepEqual(payload.services, {
    web: { port: 5100, hostname: "otter.test", url: "https://otter.test" },
    api: { port: 5101, hostname: "api.otter.test", url: "https://api.otter.test" },
    worker: { port: 5102, hostname: null, url: null },
  });
});

test("current --format short prints the domain and service port summary", async () => {
  const { cwd } = createRegisteredRepo("badger");

  const output = await captureStdout(() => current({ cwd, format: "short" }));

  const [domain, ...ports] = output.trim().split(" ");
  assert.equal(domain, "badger.test");
  assert.deepEqual(new Set(ports), new Set(["web:5103", "api:5104", "worker:5105"]));
});

test("open --print resolves root, services, aliases, and literal subdomains", async () => {
  const { cwd } = createRegisteredRepo("lynx");

  assert.equal(await captureStdout(() => open(undefined, { cwd, print: true })), "https://lynx.test\n");
  assert.equal(await captureStdout(() => open("api", { cwd, print: true })), "https://api.lynx.test\n");
  assert.equal(
    await captureStdout(() => open("admin", { cwd, print: true })),
    "https://admin-panel.lynx.test\n",
  );
  assert.equal(
    await captureStdout(() => open("preview", { cwd, print: true })),
    "https://preview.lynx.test\n",
  );
});

test("projectOpen --print resolves project root and aliases from config", async () => {
  const configRoot = tempDir();
  writeFileSync(
    join(configRoot, ".wtenv.json"),
    JSON.stringify({
      project: {
        name: "acme",
        baseDomain: "acme.test",
        domains: [{ hostname: "acme.test", port: 443 }],
      },
      aliases: {
        admin: "admin.internal",
      },
    }),
  );

  assert.equal(await captureStdout(() => projectOpen(undefined, { configRoot, print: true })), "https://acme.test\n");
  assert.equal(
    await captureStdout(() => projectOpen("admin", { configRoot, print: true })),
    "https://admin.internal.acme.test\n",
  );
  assert.equal(
    await captureStdout(() => projectOpen("docs", { configRoot, print: true })),
    "https://docs.acme.test\n",
  );
});

test("list --json includes registered worktrees with service URLs", async () => {
  const configRoot = tempDir("wtenv-list-project-");
  registerProjectRegistration(
    "acme",
    configRoot,
    "acme.test",
    [
      { hostname: "acme.test", port: 5200 },
      { hostname: "api.acme.test", port: 5201 },
    ],
  );

  const output = await captureStdout(() => list({ json: true }));
  const payload = JSON.parse(output);
  const bySlug = new Map(payload.worktrees.map((worktree) => [worktree.slug, worktree]));
  const byProject = new Map(payload.projects.map((project) => [project.name, project]));

  assert.equal(bySlug.get("otter").domain, "otter.test");
  assert.equal(bySlug.get("otter").services.web.url, "https://*.otter.test");
  assert.equal(bySlug.get("otter").services.api.url, "https://api.otter.test");
  assert.equal(bySlug.get("otter").services.worker.url, null);
  assert.equal(bySlug.get("badger").services.web.port, 5103);
  assert.equal(bySlug.get("lynx").services.api.hostname, "api.lynx.test");
  assert.equal(byProject.get("acme").baseDomain, "acme.test");
  assert.equal(byProject.get("acme").configRoot, configRoot);
  assert.deepEqual(byProject.get("acme").domains, [
    { hostname: "acme.test", port: 5200, url: "https://acme.test" },
    { hostname: "api.acme.test", port: 5201, url: "https://api.acme.test" },
  ]);
});
