import test from "node:test";
import assert from "node:assert/strict";
import * as providerApi from "../src/provider.js";

const options = (extra = {}) => ({ provider: "groq", apiKey: "test-key", ...extra });
const reply = (content = "OK", finish_reason = "stop") => ({
  ok: true,
  json: async () => ({ choices: [{ finish_reason, message: { content } }] }),
});

test("connection check makes a small real chat request without page or prompt data", async () => {
  assert.equal(typeof providerApi.checkProvider, "function");
  let calls = 0;
  const result = await providerApi.checkProvider(options({
    model: " custom-model ", prompt: "private prompt", snapshot: { html: "private page" },
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, providerApi.PROVIDERS.groq.endpoint);
      assert.equal(init.headers.Authorization, "Bearer test-key");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "custom-model");
      assert.ok(body.max_completion_tokens > 0 && body.max_completion_tokens <= 256);
      assert.doesNotMatch(init.body, /private prompt|private page/);
      return reply();
    },
  }));
  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(result).sort(), ["elapsedMs", "model"]);
  assert.equal(result.model, "custom-model");
  assert.ok(result.elapsedMs >= 0);
});

for (const status of [401, 403, 429, 500]) {
  test(`connection check redacts HTTP ${status} and does not retry`, async () => {
    assert.equal(typeof providerApi.checkProvider, "function");
    let calls = 0;
    await assert.rejects(providerApi.checkProvider(options({ fetchImpl: async () => {
      calls++;
      return { ok: false, status, json: () => assert.fail("Must not read error body") };
    }})), error => {
      assert.doesNotMatch(error.message, /test-key/);
      assert.match(error.message, /authentication|access|quota|unavailable/i);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("connection check rejects empty and incomplete replies", async () => {
  assert.equal(typeof providerApi.checkProvider, "function");
  for (const response of [reply(""), reply("OK", "length"), { ok: true, json: async () => ({}) }]) {
    await assert.rejects(providerApi.checkProvider(options({ fetchImpl: async () => response })), /connection test|response/i);
  }
});

test("connection check bounds a stalled response body to 25 seconds", async (t) => {
  assert.equal(typeof providerApi.checkProvider, "function");
  let deadline, requestSignal;
  t.mock.method(globalThis, "setTimeout", (callback, ms) => { assert.equal(ms, 25000); deadline = callback; return 1; });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const pending = providerApi.checkProvider(options({ fetchImpl: async (_url, init) => {
    requestSignal = init.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  }}));
  const rejected = assert.rejects(pending, /timed out/i);
  await Promise.resolve();
  deadline();
  await rejected;
  assert.equal(requestSignal.aborted, true);
});
