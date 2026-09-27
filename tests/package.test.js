import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
test("every packaged JavaScript module parses, including the service worker", () => {
  for (const file of readdirSync("src").filter((f) => f.endsWith(".js")))
    execFileSync(process.execPath, ["--check", `src/${file}`]);
});
test("manifest packaged entrypoints and icons exist", () => {
  const m = JSON.parse(readFileSync("src/manifest.json"));
  assert.equal(m.manifest_version, 3);
  for (const f of [
    m.background.service_worker,
    m.action.default_popup,
    ...Object.values(m.icons),
  ])
    assert.ok(existsSync(`src/${f}`), f);
  assert.ok(m.permissions.includes("userScripts"));
});
