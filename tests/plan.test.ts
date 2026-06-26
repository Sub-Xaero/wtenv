import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PluginContext } from "../src/lib/config.js";
import { shell } from "../src/lib/plugins.js";
import {
  executePlan,
  flattenPlan,
  invertPlan,
  parallel,
  PlanExecutionError,
  sequence,
} from "../src/lib/plan.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("executePlan runs sequence nodes in order", async () => {
  const order: number[] = [];

  await executePlan(sequence([1, 2, 3]), async (item) => {
    order.push(item);
  });

  assert.deepEqual(order, [1, 2, 3]);
});

test("executePlan starts parallel siblings concurrently", async () => {
  let running = 0;
  let maxRunning = 0;

  await executePlan(parallel([1, 2]), async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await delay(30);
    running--;
  });

  assert.equal(maxRunning, 2);
});

test("executePlan waits for all parallel siblings before reporting failure", async () => {
  const started = Date.now();
  let completedSlowTask = false;

  await assert.rejects(
    executePlan(parallel(["slow", "fail"]), async (item) => {
      if (item === "fail") {
        await delay(10);
        throw new Error("failed");
      }
      await delay(50);
      completedSlowTask = true;
    }),
    (err) => {
      assert.ok(err instanceof PlanExecutionError);
      assert.deepEqual(flattenPlan(err.completed), ["slow"]);
      return true;
    }
  );

  assert.equal(completedSlowTask, true);
  assert.ok(Date.now() - started >= 45);
});

test("invertPlan reverses sequences while preserving parallel groups", () => {
  const plan = sequence([1, parallel([2, sequence([3, 4])]), 5]);

  assert.deepEqual(flattenPlan(invertPlan(plan)), [5, 2, 4, 3, 1]);
});

test("failed plans expose completed work for reverse-order rollback", async () => {
  const plan = sequence(["setup", parallel(["cache", "fail"]), "never"]);
  const rollback: string[] = [];

  try {
    await executePlan(plan, async (item) => {
      if (item === "fail") throw new Error("failed");
      assert.notEqual(item, "never");
    });
    assert.fail("expected plan to fail");
  } catch (err) {
    assert.ok(err instanceof PlanExecutionError);
    await executePlan(invertPlan(err.completed), async (item) => {
      rollback.push(item);
    });
  }

  assert.deepEqual(rollback, ["cache", "setup"]);
});


test("shell accepts grouped command plans", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "wtenv-shell-"));
  const out = join(cwd, "out.txt");
  const plugin = shell({
    onRegister: parallel([
      `node -e "setTimeout(() => require('fs').appendFileSync('${out}', 'a'), 250)"`,
      `node -e "setTimeout(() => require('fs').appendFileSync('${out}', 'b'), 250)"`,
    ]),
  });
  const ctx: PluginContext = {
    worktreeId: "id",
    worktreeName: "worktree",
    slug: "slug",
    cwd,
    configRoot: cwd,
    ports: {},
    envVars: {},
    config: { tld: "test", services: {} },
  };

  const started = Date.now();
  try {
    await plugin.onRegister?.(ctx);
    assert.equal([...readFileSync(out, "utf8")].sort().join(""), "ab");
    assert.ok(Date.now() - started < 550);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
