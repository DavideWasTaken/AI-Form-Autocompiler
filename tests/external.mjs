// Opt-in live evidence: node tests/external.mjs --provider=groq
// Credentials come only from OPENAI_API_KEY / GROQ_API_KEY. Never submit demos.
import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, cp, readFile, writeFile, mkdtemp } from "node:fs/promises";
import assert from "node:assert/strict";
import { PROVIDERS } from "../src/provider.js";
import { createHash } from "node:crypto";

const option = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const provider = option("provider") || "groq";
if (!Object.hasOwn(PROVIDERS, provider)) throw new Error("Unknown provider");
const apiKey = process.env[`${provider.toUpperCase()}_API_KEY`];
if (!apiKey) throw new Error(`Set ${provider.toUpperCase()}_API_KEY to run live checks`);
const caseFilter = option("case");
const label = option("label") || "current";
if (!/^[a-z0-9-]+$/.test(label)) throw new Error("Invalid evidence label");
const verifyUndo = process.argv.includes("--undo");
const cases = [
  {
    id: "selenium-web-form",
    url: "https://www.selenium.dev/selenium/web/web-form.html",
    prompt: 'Fill Text input with Alex Rossi; Textarea with "Synthetic demo only"; Dropdown (select) with Two; Dropdown (datalist) with New York. Enable Default checkbox. Leave all other controls unchanged. Do not submit, navigate, or click buttons.',
    expected: { '[name="my-text"]': "Alex Rossi", '[name="my-textarea"]': "Synthetic demo only", '[name="my-select"]': "2", '[name="my-datalist"]': "New York", "#my-check-2": true, '[name="my-readonly"]': "Readonly input" },
  },
  {
    id: "selenium-form-page",
    url: "https://www.selenium.dev/selenium/web/formPage.html",
    prompt: 'Fill email (id email) with alex.rossi@example.test; age (id age) with 34; select Ham and Sausages in the multiple select (id multi); fill the empty textarea (id emptyTextArea) with "Synthetic demo only". Preserve existing text and all other controls. Do not submit, navigate, or click buttons.',
    expected: { "#email": "alex.rossi@example.test", "#age": "34", "#multi": ["ham", "sausages"], "#emptyTextArea": "Synthetic demo only", "#inputWithText": "Example text", "#withText": "Example text" },
  },
  {
    id: "playwright-todomvc",
    url: "https://demo.playwright.dev/todomvc/",
    prompt: 'Fill the input "What needs to be done?" with "Review synthetic Alex Rossi demo". Leave it as draft text. Do not press Enter, create a todo, click a button, submit, or navigate.',
    expected: { '[placeholder="What needs to be done?"]': "Review synthetic Alex Rossi demo" },
  },
];
if (caseFilter && !cases.some((c) => c.id === caseFilter)) throw new Error("Unknown --case");
await mkdir("output", { recursive: true });
const extension = await mkdtemp(resolve("output/external-extension-"));
await cp("src", extension, { recursive: true });
const manifest = JSON.parse(await readFile(`${extension}/manifest.json`, "utf8"));
// A popup opened as a tab cannot obtain an action-button activeTab gesture.
// Test only these official demo origins; native permission prompting is unverified.
manifest.host_permissions.push("https://www.selenium.dev/*", "https://demo.playwright.dev/*");
await writeFile(`${extension}/manifest.json`, JSON.stringify(manifest));
const sourceHashes = {};
for (const file of ["background.js", "capture.js", "execution.js", "provider.js", "recovery.js"]) {
  try { sourceHashes[file] = createHash("sha256").update(await readFile(`${extension}/${file}`)).digest("hex"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const profile = await mkdtemp(resolve("output/external-profile-"));
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [];
let blockedProvider = false;
let lastAttempt = 0;
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const settings = await context.newPage();
  await settings.goto(`chrome://extensions/?id=${extensionId}`);
  await settings.locator("#allow-user-scripts").locator("cr-toggle").click();
  await settings.close();
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extensionId}/popup.html`);
  // Session storage is in-memory. Never enable persisted keys in this harness.
  await worker.evaluate(async ({ provider, apiKey }) => {
    await chrome.storage.session.set({ apiKeys: { [provider]: apiKey } });
  }, { provider, apiKey });
  for (const testCase of cases.filter((c) => !caseFilter || c.id === caseFilter)) {
    if (blockedProvider) {
      results.push({ id: testCase.id, status: "skipped", reason: "Provider authentication or quota failure" });
      continue;
    }
    const page = await context.newPage();
    let armed = false;
    let blockedNavigation = 0;
    let blockedWrites = 0;
    let attemptedSubmits = 0;
    let response;
    const readValue = (selector) => page.locator(selector).evaluate((element) =>
      element.matches('input[type="checkbox"],input[type="radio"]') ? element.checked :
      element.matches("select[multiple]") ? [...element.selectedOptions].map((o) => o.value) : element.value);
    await page.exposeFunction("externalSubmissionAttempt", () => { attemptedSubmits++; });
    await page.addInitScript(() => {
      const stop = (event) => {
        event?.preventDefault();
        event?.stopImmediatePropagation();
        window.externalSubmissionAttempt();
      };
      document.addEventListener("submit", stop, true);
      HTMLFormElement.prototype.submit = stop;
      HTMLFormElement.prototype.requestSubmit = stop;
    });
    // Page requests are independent from the extension worker's provider request.
    // Once loaded, deny every outgoing page request, including GET submissions.
    await page.route("**/*", async (route) => {
      const request = route.request();
      const write = !["GET", "HEAD", "OPTIONS"].includes(request.method());
      if (armed || write) {
        if (request.isNavigationRequest()) blockedNavigation++;
        if (write) blockedWrites++;
        await route.abort("blockedbyclient");
      } else await route.continue();
    });
    const start = Date.now();
    try {
      await page.goto(testCase.url, { waitUntil: "networkidle", timeout: 30000 });
      await page.locator("input").first().waitFor();
      armed = true;
      const originalUrl = page.url();
      const initial = {};
      for (const selector of Object.keys(testCase.expected)) initial[selector] = await readValue(selector);
      const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, originalUrl);
      assert.ok(Number.isInteger(tabId));
      const wait = provider === "groq" ? Math.max(0, 45000 - (Date.now() - lastAttempt)) : 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      lastAttempt = Date.now();
      response = await ui.evaluate((message) => chrome.runtime.sendMessage(message), {
        action: "fill", tabId, provider, model: PROVIDERS[provider].model, prompt: testCase.prompt,
      });
      assert.equal(response.ok, true, response.error);
      assert.ok(response.result.verified > 0);
      assert.equal(response.result.failed.length, 0);
      const observed = {};
      for (const [selector, expected] of Object.entries(testCase.expected)) {
        observed[selector] = await readValue(selector);
        assert.deepEqual(observed[selector], expected, selector);
      }
      if (testCase.id === "playwright-todomvc") assert.equal(await page.locator(".todo-list li").count(), 0);
      assert.equal(page.url(), originalUrl);
      assert.equal(attemptedSubmits, 0, "Generated code attempted submission");
      assert.equal(blockedNavigation, 0, "Generated code attempted navigation");
      assert.equal(blockedWrites, 0, "Page attempted an outgoing write");
      await page.screenshot({ path: `output/external-${label}-${provider}-${testCase.id}.png`, fullPage: true });
      let undo;
      if (verifyUndo) {
        undo = await ui.evaluate((message) => chrome.runtime.sendMessage(message), { action: "undo", tabId });
        assert.equal(undo.ok, true, undo.error);
        for (const [selector, expected] of Object.entries(initial)) assert.deepEqual(await readValue(selector), expected, `undo ${selector}`);
        assert.equal(attemptedSubmits + blockedNavigation + blockedWrites, 0, "Undo must not submit or navigate");
      }
      results.push({ id: testCase.id, url: originalUrl, status: "passed", elapsedMs: Date.now() - start, aiMs: response.result.elapsedMs, verified: response.result.verified, observed, undoVerified: Boolean(undo), attemptedSubmits, blockedNavigation, blockedWrites });
      console.log(`PASS ${provider} ${testCase.id}: ${response.result.verified} verified; no submissions`);
    } catch (error) {
      // Provider module redacts provider bodies; also never emit the key if a browser error echoes it.
      const safeError = String(error.message).replaceAll(apiKey, "[redacted]").slice(0, 500);
      if (/authentication|quota|denied access/i.test(safeError)) blockedProvider = true;
      results.push({ id: testCase.id, url: testCase.url, status: "failed", error: safeError, elapsedMs: Date.now() - start, attemptedSubmits, blockedNavigation, blockedWrites });
      console.log(`FAIL ${provider} ${testCase.id}: ${safeError}`);
    } finally { await page.close(); }
  }
} finally {
  await context.close();
  await writeFile(`output/external-${label}-${provider}-results.json`, JSON.stringify({
    date: new Date().toISOString(), label, provider, model: PROVIDERS[provider].model, extensionVersion: manifest.version, sourceHashes,
    permissionMethod: "Test-copy manifest grants two demo origins; native action/permission UI unverified",
    safety: "Synthetic data; page network locked after load; form submission intercepted; no submit clicks",
    limitations: "These selected controls only; Google Forms, Typeform, iframes and native permission prompts unverified",
    results,
  }, null, 2));
}
if (results.some((r) => r.status === "failed")) process.exitCode = 1;
