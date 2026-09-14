import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function fixture(t, configuredSlug) {
  const root = mkdtempSync(join(tmpdir(), "wtenv-reregister-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "repo");
  const home = join(root, "home");
  mkdirSync(cwd);
  mkdirSync(home);
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(join(cwd, ".wtenv.config.js"), `
    import { ports, serviceEnv, sequence } from "wtenv";
    import { appendFileSync } from "node:fs";
    import { join } from "node:path";

    function record(phase, ctx) {
      appendFileSync(join(ctx.cwd, "hooks.jsonl"), JSON.stringify({
        phase, slug: ctx.slug, name: ctx.worktreeName,
      }) + "\\n");
    }

    export default {
      tld: "test",
      services: { web: { hostname: "*", env: { PORT: "{port}" } } },
      plugins: sequence([
        ports(${JSON.stringify({ slug: configuredSlug })}),
        serviceEnv(),
        {
          name: "test:hooks",
          onRegister(ctx) { record("register", ctx); },
          onDeregister(ctx) { record("deregister", ctx); },
        },
      ]),
    };
  `);
  const run = (...args) => execFileSync(process.execPath, ["--", cli, ...args], {
    cwd,
    env: { ...process.env, HOME: home, NO_COLOR: "1", NODE_NO_WARNINGS: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    cwd,
    run,
    current: () => JSON.parse(run("current", "--format", "json")),
    hooks: () => readFileSync(join(cwd, "hooks.jsonl"), "utf8").trim().split("\n").map(JSON.parse),
  };
}

test("reregister --keep-name preserves provisioned names and reruns all hooks", (t) => {
  const { cwd, run, current, hooks } = fixture(t, "configured-name");
  run("register", "original-display", "--slug", "provisioned-name", "--env-file", ".env.branch");
  writeFileSync(join(cwd, ".env.branch"), "STALE=true\n");

  run("reregister", "--keep-name", "--env-file", ".env.branch");

  assert.equal(current().slug, "provisioned-name");
  assert.equal(current().name, "original-display");
  assert.deepEqual(hooks(), ["register", "deregister", "register"].map((phase) => ({
    phase, slug: "provisioned-name", name: "original-display",
  })));
  const env = readFileSync(join(cwd, ".env.branch"), "utf8");
  assert.match(env, /^WTENV_SLUG=provisioned-name$/m);
  assert.match(env, /^WTENV_DOMAIN=provisioned-name.test$/m);
  assert.match(env, /^PORT=\d+$/m);
  assert.doesNotMatch(env, /STALE/);
  assert.equal(existsSync(join(cwd, ".env.worktree")), false);
});

test("reregister --keep-name provisions a clean worktree and reuses its name next time", (t) => {
  const { cwd, run, current, hooks } = fixture(t);
  run("reregister", "--keep-name");
  const first = current();
  assert.ok(first.slug);
  assert.equal(first.name, basename(cwd));

  run("reregister", "--keep-name");

  assert.equal(current().slug, first.slug);
  assert.deepEqual(hooks(), ["register", "deregister", "register"].map((phase) => ({
    phase, slug: first.slug, name: first.name,
  })));
});

test("reregister --keep-name allows an explicit display name while preserving the slug", (t) => {
  const { run, current } = fixture(t);
  run("register", "original-display", "--slug", "provisioned-name");
  run("reregister", "new-display", "--keep-name");

  assert.equal(current().slug, "provisioned-name");
  assert.equal(current().name, "new-display");
});

test("reregister without --keep-name retains normal name and slug allocation", (t) => {
  const { cwd, run, current, hooks } = fixture(t, "configured-name");
  run("register", "original-display", "--slug", "provisioned-name");
  run("reregister");

  assert.equal(current().slug, "configured-name");
  assert.equal(current().name, basename(cwd));
  assert.deepEqual(hooks().map(({ phase, slug }) => ({ phase, slug })), [
    { phase: "register", slug: "provisioned-name" },
    { phase: "deregister", slug: "provisioned-name" },
    { phase: "register", slug: "configured-name" },
  ]);
});
