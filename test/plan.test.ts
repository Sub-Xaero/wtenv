import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PluginContext } from "../src/lib/config.js";
import { captureLogs } from "../src/lib/log.js";
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

test("executePlan with a label runs a progress-tracked batch and reports items as managed", async () => {
  const managedFlags: boolean[] = [];

  const result = await executePlan(
    parallel(["slow", "fast"]),
    async (item, reporter) => {
      managedFlags.push(reporter.managed);
      if (item === "fast") return;
      await delay(30);
    },
    { label: (item) => item }
  );

  // Completed items keep original declaration order, not finish order.
  assert.deepEqual(flattenPlan(result), ["slow", "fast"]);
  assert.deepEqual(managedFlags, [true, true]);
});

test("executePlan with a label still surfaces failures for rollback", async () => {
  await assert.rejects(
    executePlan(
      parallel(["slow", "fail"]),
      async (item) => {
        if (item === "fail") throw new Error("failed");
        await delay(30);
      },
      { label: (item) => item }
    ),
    (err) => {
      assert.ok(err instanceof PlanExecutionError);
      assert.deepEqual(flattenPlan(err.completed), ["slow"]);
      return true;
    }
  );
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
    gitRoot: cwd,
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

test("shell buffers parallel command output by command", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "wtenv-shell-logs-"));
  const plugin = shell({
    onRegister: parallel([
      `node -e "process.stdout.write('a1\\\\n'); setTimeout(() => process.stdout.write('a2\\\\n'), 80)"`,
      `node -e "process.stdout.write('b1\\\\n'); setTimeout(() => process.stdout.write('b2\\\\n'), 20)"`,
    ]),
  });
  const ctx: PluginContext = {
    worktreeId: "id",
    worktreeName: "worktree",
    slug: "slug",
    cwd,
    configRoot: cwd,
    gitRoot: cwd,
    ports: {},
    envVars: {},
    config: { tld: "test", services: {} },
  };

  try {
    const captured = await captureLogs(() => plugin.onRegister?.(ctx));
    if (!captured.ok) assert.fail(`expected shell command to pass: ${captured.error}`);
    const output = captured.output;
    const a1 = output.indexOf("a1\n");
    const a2 = output.indexOf("a2\n");
    const b1 = output.indexOf("b1\n");
    const b2 = output.indexOf("b2\n");

    assert.ok(a1 !== -1 && a2 !== -1 && b1 !== -1 && b2 !== -1);
    assert.ok(a1 < a2);
    assert.ok(b1 < b2);
    assert.equal(a1 < b1 && b1 < a2, false);
    assert.equal(b1 < a1 && a1 < b2, false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
