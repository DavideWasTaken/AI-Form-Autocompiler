import test from "node:test";
import assert from "node:assert/strict";
import { awaitExecution } from "../src/execution.js";
test("execution deadline reports uncertain state rather than success or retry", async () => {
  await assert.rejects(
    awaitExecution(new Promise(() => {}), 10),
    (error) =>
      error.code === "EXECUTION_UNCERTAIN" && /Refresh/.test(error.message),
  );
});
test("execution return values and failures are preserved", async () => {
  assert.equal(await awaitExecution(Promise.resolve("result"), 50), "result");
  await assert.rejects(
    awaitExecution(Promise.reject(new Error("script error")), 50),
    /script error/,
  );
});
