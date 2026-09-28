import test from "node:test";
import assert from "node:assert/strict";

import { PROVIDERS, buildMessages, generateScript } from "../src/provider.js";
const snapshot = {
  html: '<input data-af-id="f1">',
  fields: [{ id: "f1", tag: "input", type: "text", label: "Name", value: "" }],
  url: "https://example.test/form",
  title: "Registration",
};
const code =
  'af.set("f1", "Ada"); return {filled:[{id:"f1",value:"Ada"}],skipped:[]};';
const completion = (content = code, extra = {}) => ({
  choices: [{ finish_reason: "stop", message: { content }, ...extra }],
});
const response = (payload = completion()) => ({
  ok: true,
  status: 200,
  json: async () => payload,
});
const options = (overrides = {}) => ({
  provider: "openai",
  apiKey: "secret-example-key",
  prompt: "My name is Ada",
  snapshot,
  fetchImpl: async () => response(),
  ...overrides,
});

test("exports the approved provider API", () => {
  assert.equal(typeof generateScript, "function");
  assert.equal(typeof buildMessages, "function");
  assert.equal(
    PROVIDERS.openai.endpoint,
    "https://api.openai.com/v1/chat/completions",
  );
  assert.equal(PROVIDERS.openai.model, "gpt-4.1-mini");
  assert.equal(
    PROVIDERS.groq.endpoint,
    "https://api.groq.com/openai/v1/chat/completions",
  );
  assert.equal(PROVIDERS.groq.model, "openai/gpt-oss-120b");
});

test("messages define DOM helper and return contract and treat page content as data", () => {
  const messages = buildMessages(snapshot, "My name is Ada");
  assert.equal(messages[0].role, "system");
  for (const term of [
    "af.set",
    "af.get",
    "data-af-id",
    "filled",
    "skipped",
    "untrusted",
    "submit",
    "network",
    "preserve",
    "invent",
  ])
    assert.ok(
      messages[0].content.toLowerCase().includes(term.toLowerCase()),
      term,
    );
  assert.equal(messages[1].role, "user");
  const input = JSON.parse(messages[1].content);
  assert.equal(input.prompt, "My name is Ada");
  assert.deepEqual(input.page, snapshot);
});

test("messages restrict modifications to captured target IDs for scoped filling", () => {
  const messages = buildMessages({ ...snapshot, scope: "empty" }, "My name is Ada");
  assert.match(messages[0].content, /modify only.*captured target IDs/i);
  assert.match(messages[0].content, /scope.*empty.*failed/i);
  assert.equal(JSON.parse(messages[1].content).page.scope, "empty");
});

for (const provider of ["openai", "groq"])
  test(`${provider} sends one authenticated request and returns code and timing`, async () => {
    let requests = 0;
    const result = await generateScript(
      options({
        provider,
        fetchImpl: async (url, init) => {
          requests++;
          assert.equal(url, PROVIDERS[provider].endpoint);
          assert.equal(init.method, "POST");
          assert.equal(init.headers.Authorization, "Bearer secret-example-key");
          assert.equal(init.headers["Content-Type"], "application/json");
          assert.ok(init.signal instanceof AbortSignal);
          const body = JSON.parse(init.body);
          assert.equal(body.model, PROVIDERS[provider].model);
          assert.deepEqual(
            body.messages,
            buildMessages(snapshot, "My name is Ada"),
          );
          assert.ok(
            body.max_completion_tokens > 0 &&
              body.max_completion_tokens <= 10000,
          );
          return response();
        },
      }),
    );
    assert.equal(requests, 1);
    assert.equal(result.code, code);
    assert.equal(result.model, PROVIDERS[provider].model);
    assert.ok(Number.isFinite(result.elapsedMs) && result.elapsedMs >= 0);
  });

test("uses a custom model and removes one complete JavaScript fence", async () => {
  const result = await generateScript(
    options({
      model: "custom-model",
      fetchImpl: async (_url, init) => {
        assert.equal(JSON.parse(init.body).model, "custom-model");
        return response(completion("```javascript\n" + code + "\n```"));
      },
    }),
  );
  assert.equal(result.code, code);
  assert.equal(result.model, "custom-model");
});

for (const [name, override, pattern] of [
  ["unknown provider", { provider: "https://evil.test" }, /provider/i],
  ["prototype provider", { provider: "__proto__" }, /provider/i],
  ["missing key", { apiKey: " " }, /key/i],
  ["blank prompt", { prompt: " " }, /prompt/i],
  ["overlong prompt", { prompt: "a".repeat(6001) }, /prompt.*6000/i],
  [
    "large snapshot",
    { snapshot: { ...snapshot, html: "x".repeat(120001) } },
    /120000|too large/i,
  ],
  [
    "large field data",
    {
      snapshot: {
        ...snapshot,
        fields: [{ ...snapshot.fields[0], value: "x".repeat(120001) }],
      },
    },
    /120000|too large/i,
  ],
  ["missing snapshot", { snapshot: null }, /snapshot/i],
])
  test(`rejects ${name} before a network request`, async () => {
    await assert.rejects(
      generateScript(
        options({
          ...override,
          fetchImpl: () => {
            assert.fail("Unexpected network request");
          },
        }),
      ),
      pattern,
    );
  });

for (const [status, pattern] of [
  [401, /key|authentication/i],
  [403, /access|permission/i],
  [429, /rate|quota/i],
  [500, /provider|server/i],
])
  test(`HTTP ${status} is redacted, read at most once and never retried`, async () => {
    let calls = 0,
      reads = 0;
    await assert.rejects(
      generateScript(
        options({
          fetchImpl: async () => {
            calls++;
            return {
              ok: false,
              status,
              text: async () => {
                reads++;
                return "secret-example-key raw-private-payload";
              },
            };
          },
        }),
      ),
      (error) => {
        assert.match(error.message, pattern);
        assert.doesNotMatch(
          error.message,
          /secret-example-key|raw-private-payload/,
        );
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.ok(reads <= 1);
  });

for (const [name, payload] of [
  ["missing choices", {}],
  ["empty choices", { choices: [] }],
  ["empty output", completion("  ")],
  ["nonstring output", completion([{ text: code }])],
  ["truncated output", completion(code, { finish_reason: "length" })],
  ["content filter", completion(code, { finish_reason: "content_filter" })],
  [
    "refusal",
    completion(code, {
      message: { content: code, refusal: "I cannot comply." },
    }),
  ],
  ["oversized code", completion("x".repeat(30001))],
  ["unclosed fence", completion("```js\n" + code)],
])
  test(`rejects ${name}`, async () => {
    await assert.rejects(
      generateScript(options({ fetchImpl: async () => response(payload) })),
      /output|script|refus|truncat|incomplete/i,
    );
  });

test("invalid JSON is reported without including raw provider details", async () => {
  await assert.rejects(
    generateScript(
      options({
        fetchImpl: async () => ({
          ok: true,
          json: async () => {
            throw Error("private payload");
          },
        }),
      }),
    ),
    (error) => {
      assert.doesNotMatch(error.message, /private payload/);
      assert.match(error.message, /response|JSON/i);
      return true;
    },
  );
});

test("network failures are redacted", async () => {
  await assert.rejects(
    generateScript(
      options({
        fetchImpl: async () => {
          throw Error("secret-example-key");
        },
      }),
    ),
    (error) => {
      assert.doesNotMatch(error.message, /secret-example-key/);
      assert.match(error.message, /network|connect/i);
      return true;
    },
  );
});

test("already cancelled requests do not reach fetch", async () => {
  const controller = new AbortController();
  controller.abort("secret");
  await assert.rejects(
    generateScript(
      options({
        signal: controller.signal,
        fetchImpl: () => assert.fail("Unexpected fetch"),
      }),
    ),
    /cancel/i,
  );
});

test("cancelling a pending request aborts fetch and promptly rejects", async () => {
  const controller = new AbortController();
  let requestSignal;
  const pending = generateScript(
    options({
      signal: controller.signal,
      fetchImpl: (_url, init) => {
        requestSignal = init.signal;
        return new Promise(() => {});
      },
    }),
  );
  controller.abort();
  await assert.rejects(pending, /cancel/i);
  assert.equal(requestSignal.aborted, true);
});

test("25 second deadline covers a stalled response body", async (t) => {
  let fireDeadline;
  const timer = {};
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    assert.equal(delay, 25000);
    fireDeadline = callback;
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (value) =>
    assert.equal(value, timer),
  );
  let requestSignal;
  const pending = generateScript(
    options({
      fetchImpl: async (_url, init) => {
        requestSignal = init.signal;
        return { ok: true, json: () => new Promise(() => {}) };
      },
    }),
  );
  const rejected = assert.rejects(pending, /timed out|timeout/i);
  await Promise.resolve();
  fireDeadline();
  await rejected;
  assert.equal(requestSignal.aborted, true);
});
