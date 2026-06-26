import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadEnvStack, composeEnvStack } from "../dist/lib/env-stack.js";
import { envExport, envUnset } from "../dist/commands/env.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "wtenv-env-"));
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

test("loadEnvStack merges .env, .env.local, and worktree env in order", () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, ".env"), "SHARED=base\nBASE_ONLY=1\nQUOTED=\"hello world\"\n");
  writeFileSync(join(cwd, ".env.local"), "SHARED=local\nLOCAL_ONLY=1\n");
  writeFileSync(join(cwd, ".env.worktree"), "SHARED=worktree\nWT_ONLY=1\n");

  const stack = loadEnvStack({ cwd });

  assert.equal(stack.cwd, cwd);
  assert.deepEqual(stack.layers, [".env", ".env.local", ".env.worktree"]);
  assert.deepEqual(stack.present, [".env", ".env.local", ".env.worktree"]);
  assert.deepEqual(stack.merged, {
    SHARED: "worktree",
    BASE_ONLY: "1",
    QUOTED: "hello world",
    LOCAL_ONLY: "1",
    WT_ONLY: "1",
  });
  assert.equal(stack.source.SHARED, ".env.worktree");
  assert.equal(stack.source.BASE_ONLY, ".env");
  assert.equal(stack.source.LOCAL_ONLY, ".env.local");
});

test("loadEnvStack supports a custom final env file", () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, ".env"), "VALUE=base\n");
  writeFileSync(join(cwd, ".env.preview"), "VALUE=preview\nPREVIEW_ONLY=yes\n");

  const stack = loadEnvStack({ cwd, envFile: ".env.preview" });

  assert.deepEqual(stack.layers, [".env", ".env.local", ".env.preview"]);
  assert.deepEqual(stack.present, [".env", ".env.preview"]);
  assert.equal(stack.merged.VALUE, "preview");
  assert.equal(stack.source.VALUE, ".env.preview");
  assert.equal(stack.merged.PREVIEW_ONLY, "yes");
});

test("composeEnvStack overlays dotenv values on top of process.env", () => {
  const cwd = tempDir();
  const previous = process.env.WTENV_TEST_VALUE;
  process.env.WTENV_TEST_VALUE = "from-process";
  writeFileSync(join(cwd, ".env.worktree"), "WTENV_TEST_VALUE=from-worktree\n");

  try {
    const env = composeEnvStack({ cwd });
    assert.equal(env.WTENV_TEST_VALUE, "from-worktree");
  } finally {
    if (previous === undefined) delete process.env.WTENV_TEST_VALUE;
    else process.env.WTENV_TEST_VALUE = previous;
  }
});

test("envExport emits shell-safe exports for merged stack values", () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, ".env"), "PLAIN=value\nSPACE=hello world\nQUOTE=it's ok\n");

  const output = captureStdout(() => envExport({ cwd }));

  assert.deepEqual(new Set(output.trimEnd().split("\n")), new Set([
    "export PLAIN='value'",
    "export SPACE='hello world'",
    "export QUOTE='it'\\''s ok'",
  ]));
});

test("envUnset emits unset commands for keys in the merged stack", () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, ".env"), "A=1\nB=2\n");
  writeFileSync(join(cwd, ".env.worktree"), "B=3\nC=4\n");

  const output = captureStdout(() => envUnset({ cwd }));

  assert.equal(output, "unset A\nunset B\nunset C\n");
});
