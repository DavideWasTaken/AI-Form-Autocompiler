import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { PROVIDERS } from "../src/provider.js";

const html = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");
const script = (await readFile(new URL("../src/popup.js", import.meta.url), "utf8")).replace('import { PROVIDERS } from "./provider.js";', "");
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

test("popup exposes readiness, connection check, scoped fill and recovery actions", async () => {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const calls = [];
  const recovery = { canUndo: true, changed: 1, fields: [{ id: "f1", label: "Name", status: "failed" }] };
  const outcome = { ok: true, result: { verified: 1, changed: 1, failed: [], skipped: [], elapsedMs: 50, model: "test", recovery } };
  dom.window.PROVIDERS = PROVIDERS;
  dom.window.chrome = {
    tabs: { query: async () => [{ id: 1, url: "https://example.test/form" }] },
    storage: { local: { get: async () => ({}), set: async () => {} }, session: { get: async () => ({ apiKeys: { groq: "test-key" } }) } },
    permissions: { contains: async () => false, request: async () => true },
    runtime: { sendMessage: async message => {
      calls.push(message);
      if (message.action === "status") return { ok: true, result: { available: true, busy: false, recovery } };
      if (message.action === "check-provider") return { ok: true, result: { model: "test", elapsedMs: 50 } };
      if (message.action === "undo") return { ok: true, result: { canUndo: false, changed: 1, restored: 1, conflicts: 0, fields: [] } };
      return outcome;
    } },
  };
  dom.window.eval(script);
  await settle();
  const $ = id => dom.window.document.getElementById(id);
  assert.ok($("check-provider"), "connection test action is present");
  assert.match($("readiness").textContent, /scripts.*ready/is);
  assert.match($("ready-site").textContent, /fill.*access/is);
  $("check-provider").click();
  await settle();
  assert.ok(calls.some(call => call.action === "check-provider" && call.provider === "groq"));
  assert.match($("connection-status").textContent, /connected/i);
  $("prompt").value = "Name is Ada";
  $("scope").value = "failed";
  $("fill").click();
  await settle();
  assert.ok(calls.some(call => call.action === "fill" && call.scope === "failed"));
  assert.equal($("undo").disabled, false);
  $("undo").click();
  await settle();
  assert.ok(calls.some(call => call.action === "undo"));
  assert.match($("status").textContent, /1.*restored/i);
  assert.doesNotMatch(dom.window.document.body.textContent, /experimental|\bLAB\b/i);
  dom.window.close();
});
