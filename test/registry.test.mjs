import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const isolatedHome = mkdtempSync(join(tmpdir(), "wtenv-registry-home-"));
process.env.HOME = isolatedHome;

const registry = await import("../dist/lib/registry.js");

test("validateSlug accepts DNS-safe labels and rejects unsafe labels", () => {
  assert.doesNotThrow(() => registry.validateSlug("bozeman-42"));
  assert.doesNotThrow(() => registry.validateSlug("a"));

  assert.throws(
    () => registry.validateSlug("Uppercase"),
    /Invalid slug 'Uppercase'/,
  );
  assert.throws(
    () => registry.validateSlug("-leading"),
    /Invalid slug '-leading'/,
  );
  assert.throws(
    () => registry.validateSlug("trailing-"),
    /Invalid slug 'trailing-'/,
  );
});

test("allocateWorktree stores requested slug, sequential ports, and registration state", () => {
  const result = registry.allocateWorktree(
    "worktree-a",
    "alpha",
    "/tmp/alpha",
    ["web", "api"],
    [3100, 3105],
    { slugHint: "otter" },
  );

  assert.deepEqual(result, {
    slug: "otter",
    ports: { web: 3100, api: 3101 },
  });
  assert.equal(registry.isRegistered("worktree-a"), true);
  const worktree = registry.getWorktree("worktree-a");
  assert.equal(typeof worktree.created_at, "number");
  assert.deepEqual({ ...worktree, created_at: "<timestamp>" }, {
    id: "worktree-a",
    name: "alpha",
    slug: "otter",
    project_root: "/tmp/alpha",
    created_at: "<timestamp>",
  });
  assert.deepEqual(registry.getWorktreePorts("worktree-a"), { web: 3100, api: 3101 });
});

test("allocateWorktree skips ports already assigned to other worktrees", () => {
  const result = registry.allocateWorktree(
    "worktree-b",
    "beta",
    "/tmp/beta",
    ["web", "worker"],
    [3100, 3105],
    { slugHint: "badger" },
  );

  assert.deepEqual(result, {
    slug: "badger",
    ports: { web: 3102, worker: 3103 },
  });
});

test("allocateWorktree rejects duplicate worktree IDs and slugs", () => {
  assert.throws(
    () =>
      registry.allocateWorktree(
        "worktree-a",
        "duplicate",
        "/tmp/duplicate",
        ["web"],
        [3200, 3202],
        { slugHint: "lynx" },
      ),
    /already registered/,
  );

  assert.throws(
    () =>
      registry.allocateWorktree(
        "worktree-c",
        "gamma",
        "/tmp/gamma",
        ["web"],
        [3200, 3202],
        { slugHint: "otter" },
      ),
    /Slug 'otter' is already in use/,
  );
});

test("renameWorktreeSlug enforces uniqueness and updates lookup state", () => {
  assert.throws(
    () => registry.renameWorktreeSlug("worktree-b", "otter"),
    /Slug 'otter' is already in use/,
  );

  registry.renameWorktreeSlug("worktree-b", "yak");

  assert.equal(registry.getWorktree("worktree-b").slug, "yak");
  assert.equal(registry.getWorktreeBySlug("badger"), null);
  assert.equal(registry.getWorktreeBySlug("yak").id, "worktree-b");
});

test("releaseWorktree removes the worktree and cascades port assignments", () => {
  registry.releaseWorktree("worktree-a");

  assert.equal(registry.isRegistered("worktree-a"), false);
  assert.equal(registry.getWorktree("worktree-a"), null);
  assert.deepEqual(registry.getWorktreePorts("worktree-a"), {});
});

test("project registrations store static domains and replace on re-register", () => {
  registry.registerProjectRegistration(
    "acme",
    "/tmp/acme",
    "acme.test",
    [
      { hostname: "acme.test", port: 5000 },
      { hostname: "api.acme.test", port: 5001 },
    ],
  );

  let projects = registry.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, "acme");
  assert.equal(projects[0].config_root, "/tmp/acme");
  assert.equal(projects[0].base_domain, "acme.test");
  assert.deepEqual(projects[0].domains, [
    { hostname: "acme.test", port: 5000 },
    { hostname: "api.acme.test", port: 5001 },
  ]);

  registry.registerProjectRegistration(
    "acme",
    "/tmp/acme-renamed",
    "acme.local",
    [{ hostname: "acme.local", port: 5100 }],
  );

  projects = registry.listProjects();
  assert.equal(projects.length, 1);
  assert.equal(projects[0].config_root, "/tmp/acme-renamed");
  assert.equal(projects[0].base_domain, "acme.local");
  assert.deepEqual(projects[0].domains, [{ hostname: "acme.local", port: 5100 }]);

  registry.releaseProjectRegistration("acme");
  assert.deepEqual(registry.listProjects(), []);
});

test("Redis database allocation uses the first free index and releases it", () => {
  registry.allocateWorktree(
    "worktree-d",
    "delta",
    "/tmp/delta",
    [],
    [3300, 3302],
    { slugHint: "ibex" },
  );
  registry.allocateWorktree(
    "worktree-e",
    "epsilon",
    "/tmp/epsilon",
    [],
    [3300, 3302],
    { slugHint: "mink" },
  );

  assert.equal(registry.allocateRedisDb("worktree-b", { dbStart: 5, dbEnd: 6 }), 5);
  assert.equal(registry.getRedisDb("worktree-b"), 5);
  assert.equal(registry.allocateRedisDb("worktree-d", { dbStart: 5, dbEnd: 6 }), 6);
  assert.throws(
    () => registry.allocateRedisDb("worktree-e", { dbStart: 5, dbEnd: 6 }),
    /Redis database index pool exhausted \(5–6\)/,
  );

  registry.releaseRedisDb("worktree-b");

  assert.equal(registry.getRedisDb("worktree-b"), null);
  assert.equal(registry.allocateRedisDb("worktree-e", { dbStart: 5, dbEnd: 6 }), 5);
});
