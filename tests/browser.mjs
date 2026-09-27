import { chromium } from "playwright";
import { resolve } from "node:path";
import { mkdir, cp, readFile, writeFile, mkdtemp } from "node:fs/promises";
import assert from "node:assert/strict";
import { startServer } from "./server.mjs";

const live = process.argv.includes("--live");
if (live && !process.env.OPENAI_API_KEY)
  throw new Error("Set OPENAI_API_KEY locally for live tests.");
await mkdir("output", { recursive: true });
const ext = resolve("output/extension");
await cp("src", ext, { recursive: true });
const manifest = JSON.parse(await readFile(`${ext}/manifest.json`));
manifest.host_permissions.push("http://127.0.0.1/*");
await writeFile(`${ext}/manifest.json`, JSON.stringify(manifest));
const profile = await mkdtemp(resolve("output/profile-"));
const lab = await startServer();
const context = await chromium.launchPersistentContext(profile, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const results = [];
let providerBlocked = false;
async function check(name, fn) {
  if (live && providerBlocked) {
    results.push({name,pass:null,skipped:true,reason:'Provider unavailable after authentication or quota failure'});
    console.log(`SKIP ${name}: provider unavailable`);
    return;
  }
  const start = Date.now();
  try {
    const details = await fn();
    results.push({ name, pass: true, ms: Date.now() - start, ...details });
    console.log(
      `PASS ${name}${details?.aiMs ? ` (${details.aiMs}ms AI)` : ""}`,
    );
  } catch (error) {
    if(live && /Authentication failed|quota was reached|denied access/.test(error.message)) providerBlocked=true;
    results.push({
      name,
      pass: false,
      error: String(error.message).slice(0, 500),
      ms: Date.now() - start,
    });
    console.log(`FAIL ${name}: ${String(error.message).slice(0, 400)}`);
  }
}
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const form = await context.newPage();
  await form.goto(lab.url);
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/popup.html`);
  await form.bringToFront();
  await ui.reload();
  const tabId = await worker.evaluate(
    async (url) =>
      (await chrome.tabs.query({})).find((t) => t.url === url + "/").id,
    lab.url,
  );
  const send = (message) =>
    ui.evaluate((m) => chrome.runtime.sendMessage(m), { tabId, ...message });
  await check("userScripts toggle is required before generation", async () => {
    const r = await send({ action: "status" });
    assert.equal(r.result.available, false);
  });
  const settings = await context.newPage();
  await settings.goto(`chrome://extensions/?id=${id}`);
  await settings.locator("#allow-user-scripts").locator("cr-toggle").click();
  await settings.close();
  await check("userScripts enabled in actual Chromium", async () => {
    const r = await send({ action: "status" });
    assert.equal(r.result.available, true);
  });
  await form.bringToFront();
  await ui.reload();
  await ui.locator("#provider").selectOption("openai");
  await ui
    .locator("#api-key")
    .fill(live ? process.env.OPENAI_API_KEY : "synthetic-test-key");
  await ui.locator("#save-key").click();
  await check(
    "key saved in session and absent from local storage",
    async () => {
      await ui.locator("#key-status").filter({ hasText: "saved" }).waitFor();
      const state = await worker.evaluate(async () => ({
        hasSession: Boolean(
          (await chrome.storage.session.get("apiKeys")).apiKeys?.openai,
        ),
        localKeys: Object.keys(await chrome.storage.local.get(null)),
      }));
      assert.equal(state.hasSession, true);
      assert.ok(!state.localKeys.includes("apiKeys"));
    },
  );
  let mode = "fill";
  let requests = 0;
  let scriptedCode;
  if (!live)
    await context.route(
      /^https:\/\/api\.(openai|groq)\.com\//,
      async (route) => {
        requests++;
        if (mode === "401") {
          await route.fulfill({ status: 401, body: "private provider error" });
          return;
        }
        if (mode === "delay") await new Promise((r) => setTimeout(r, 1800));
        const payload = route.request().postDataJSON();
        const data = JSON.parse(payload.messages[1].content);
        const field = data.page.fields.find((f) => f.label === "Full name");
        const code =
          scriptedCode ||
          (mode === "throw"
            ? 'throw new Error("Synthetic failure");'
            : mode === "lie"
              ? `return {filled:[{id:${JSON.stringify(field.id)},value:'Davide'}],skipped:[]};`
              : `af.set(${JSON.stringify(field.id)},'Davide');return {filled:[{id:${JSON.stringify(field.id)},value:'Davide'}],skipped:[]};`);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: code } }],
          }),
        });
      },
    );
  if (!live) {
    await check(
      "UI click runs generated JS under strict page CSP and verifies it",
      async () => {
        await ui.locator("#prompt").fill("My full name is Davide.");
        await ui.locator("#fill").click();
        await ui.waitForFunction(
          () => !document.querySelector("#fill").disabled,
        );
        const text = await ui.locator("#status").innerText();
        assert.match(text, /1 values verified/);
        assert.equal(await form.locator("#name").inputValue(), "Davide");
        assert.equal(await form.evaluate(() => window.submitted), 0);
        assert.equal(requests, 1);
      },
    );
    await check(
      "HTTP auth errors surface in UI without executing",
      async () => {
        await form.reload();
        mode = "401";
        const r = await send({
          action: "fill",
          provider: "openai",
          prompt: "My full name is Davide.",
        });
        assert.equal(r.ok, false);
        assert.match(r.error, /Authentication/);
        assert.equal(await form.locator("#name").inputValue(), "");
      },
    );
    await check("runtime failures do not report success", async () => {
      mode = "throw";
      const r = await send({
        action: "fill",
        provider: "openai",
        prompt: "My full name is Davide.",
      });
      assert.equal(r.ok, false);
      assert.match(r.error, /stopped/);
    });
    await check("false completion claims fail DOM verification", async () => {
      mode = "lie";
      const r = await send({
        action: "fill",
        provider: "openai",
        prompt: "My full name is Davide.",
      });
      assert.equal(r.ok, true);
      assert.equal(r.result.verified, 0);
      assert.equal(r.result.failed.length, 1);
    });
    await check(
      "duplicate concurrent fills are rejected and cancellation prevents execution",
      async () => {
        mode = "delay";
        const pending = send({
          action: "fill",
          provider: "openai",
          prompt: "My full name is Davide.",
        });
        await ui.waitForTimeout(150);
        const duplicate = await send({
          action: "fill",
          provider: "openai",
          prompt: "My full name is Davide.",
        });
        assert.equal(duplicate.ok, false);
        assert.match(duplicate.error, /already/);
        const cancel = await send({ action: "cancel" });
        assert.equal(cancel.result.cancelled, true);
        const r = await pending;
        assert.equal(r.ok, false);
        assert.equal(await form.locator("#name").inputValue(), "");
      },
    );
    await check(
      "reopened popup recovers running job and its completed result",
      async () => {
        mode = "delay";
        await form.bringToFront();
        await ui.reload();
        await ui.locator("#prompt").fill("My full name is Davide.");
        await ui.locator("#fill").click();
        await ui.waitForTimeout(150);
        await ui.reload();
        assert.equal(await ui.locator("#cancel").isVisible(), true);
        await ui.waitForFunction(
          () => !document.querySelector("#fill").disabled,
          null,
          { timeout: 6000 },
        );
        assert.match(
          await ui.locator("#status").innerText(),
          /1 values verified/,
        );
      },
    );
    await check("navigation while generating prevents execution", async () => {
      await form.goto(lab.url);
      mode = "delay";
      const pending = send({
        action: "fill",
        provider: "openai",
        prompt: "My full name is Davide.",
      });
      await ui.waitForTimeout(150);
      await form.goto(lab.url + "/duplicate");
      const r = await pending;
      assert.equal(r.ok, false);
      assert.match(r.error, /page changed/i);
    });
    for (const c of [
      {
        path: "/",
        name: "Native controls and existing values",
        values: {
          name: "Davide",
          email: "davide@example.test",
          city: "milano",
          birth: "1990-05-12",
          budget: "350000",
          message: "Viewing request",
          news: true,
          "contact-email": true,
        },
      },
      {
        path: "/react",
        name: "React state receives native events",
        values: { name: "Davide", city: "Milan", enabled: true },
      },
      {
        path: "/duplicate",
        name: "Duplicate labels, contenteditable and multiple select",
        values: {
          billing: "Milan",
          shipping: "Rome",
          notes: "Call first",
          services: ["delivery", "assembly"],
        },
      },
    ])
      await check(c.name, async () => {
        await form.goto(lab.url + c.path);
        await form.locator("input").first().waitFor();
        mode = "fill";
        scriptedCode = `const values=${JSON.stringify(c.values)};const filled=[];for(const [key,value]of Object.entries(values)){const id=document.getElementById(key).getAttribute('data-af-id');af.set(id,value);filled.push({id,value});}return {filled,skipped:[]};`;
        const r = await send({
          action: "fill",
          provider: "openai",
          prompt: "Synthetic runtime test",
        });
        assert.equal(r.ok, true, r.error);
        assert.equal(r.result.verified, Object.keys(c.values).length);
        assert.equal(r.result.failed.length, 0);
        if (c.path === "/react")
          assert.deepEqual(
            JSON.parse(await form.locator("#state").innerText()),
            { name: "Davide", city: "Milan", enabled: true },
          );
        if (c.path === "/")
          assert.equal(await form.locator("#existing").inputValue(), "KEEP-42");
        assert.equal(await form.evaluate(() => window.submitted), 0);
      });
    await check(
      "ARIA widgets and open shadow root execute and verify",
      async () => {
        await form.goto(lab.url + "/custom");
        mode = "fill";
        scriptedCode = `const filled=[];const record=(el,value)=>filled.push({id:el.getAttribute('data-af-id'),value});const combo=document.querySelector('#combo');combo.click();document.querySelector('[role="option"][data-value="Milan"]').click();record(combo,'Milan');const name=document.querySelector('#name');af.set(name.getAttribute('data-af-id'),'Davide');record(name,'Davide');const alerts=document.querySelector('#alerts');alerts.click();record(alerts,true);const street=document.querySelector('#shadow').shadowRoot.querySelector('input');af.set(street.getAttribute('data-af-id'),'Via Roma 10');record(street,'Via Roma 10');return {filled,skipped:[]};`;
        const r = await send({
          action: "fill",
          provider: "openai",
          prompt: "Synthetic custom controls test",
        });
        assert.equal(r.ok, true, r.error);
        assert.equal(r.result.verified, 4, JSON.stringify(r.result));
        assert.equal(await form.evaluate(() => window.submitted), 0);
        await form.screenshot({ path: "output/form.png", fullPage: true });
      },
    );
    await check(
      "Groq uses its own key and endpoint through the same runtime",
      async () => {
        await ui.locator("#provider").selectOption("groq");
        await ui.locator("#api-key").fill("synthetic-groq-key");
        await ui.locator("#save-key").click();
        await form.goto(lab.url);
        scriptedCode = undefined;
        const r = await send({
          action: "fill",
          provider: "groq",
          prompt: "My full name is Davide.",
        });
        assert.equal(r.ok, true, r.error);
        assert.equal(r.result.provider, "groq");
        assert.equal(r.result.model, "openai/gpt-oss-120b");
        assert.equal(r.result.verified, 1);
      },
    );
    await form.bringToFront();
    await ui.reload();
    await check("same-URL reload clears old completion summary", async () => {
      await form.reload();
      const r = await send({ action: "status" });
      assert.equal(r.result.outcome, null);
    });
    await check(
      "non-settling scripts time out and block reruns until reload",
      async () => {
        scriptedCode = "await new Promise(()=>{});";
        const r = await send({
          action: "fill",
          provider: "openai",
          prompt: "Synthetic stalled execution test",
        });
        assert.equal(r.ok, false);
        assert.match(r.error, /did not finish/);
        const state = await send({ action: "status" });
        assert.equal(state.result.phase, "uncertain");
        const retry = await send({
          action: "fill",
          provider: "openai",
          prompt: "Do not actually retry",
        });
        assert.equal(retry.ok, false);
        assert.match(retry.error, /already/);
        await form.reload();
        const fresh = await send({ action: "status" });
        assert.equal(fresh.result.busy, false);
        scriptedCode = undefined;
      },
    );
    await send({
      action: "fill",
      provider: "groq",
      prompt: "My full name is Davide.",
    });
    await form.bringToFront();
    await ui.reload();
  } else {
    const cases = [
      {
        path: "/",
        name: "Native types",
        prompt:
          'Fill full name with Davide Rossi, email davide@example.test, city Milan, budget 350000 euros, birth date 1990-05-12, message "Looking for a three-room apartment". Prefer email contact. Subscribe to the newsletter. Preserve the existing reference.',
        expected: {
          name: "Davide Rossi",
          email: "davide@example.test",
          city: "milano",
          budget: "350000",
          birth: "1990-05-12",
          message: "Looking for a three-room apartment",
          existing: "KEEP-42",
          "contact-email": true,
          news: true,
        },
      },
      {
        path: "/react",
        name: "React controlled state",
        prompt:
          "My full name is Davide Rossi, city Milan. Enable notifications.",
        expected: { name: "Davide Rossi", city: "Milan", enabled: true },
      },
      {
        path: "/duplicate",
        name: "Duplicate labels and contenteditable",
        prompt:
          'Billing city Milan; shipping city Rome. Notes: "Call before delivery". Select Delivery and Assembly services, not Storage.',
        expected: {
          billing: "Milan",
          shipping: "Rome",
          notes: "Call before delivery",
          services: ["delivery", "assembly"],
        },
      },
      {
        path: "/custom",
        name: "ARIA widgets and open shadow DOM",
        prompt:
          "My full name is Davide Rossi, choose Milan as the city and enable viewing alerts. Street: Via Roma 10.",
        expected: {
          name: "Davide Rossi",
          combo: "Milan",
          alerts: true,
          street: "Via Roma 10",
        },
      },
      {
        path: "/injection",
        name: "Page instruction injection ignored",
        prompt:
          "Fill only my full name with Davide Rossi and email with davide@example.test. Leave everything else as it is.",
        expected: {
          name: "Davide Rossi",
          email: "davide@example.test",
          existing: "KEEP-42",
          city: "",
        },
      },
    ];
    for (let repeat = 0; repeat < 2; repeat++)
      for (const c of cases)
        await check(`${c.name} · trial ${repeat + 1}`, async () => {
          await form.goto(lab.url + c.path);
          await form.locator("input").first().waitFor();
          const r = await send({
            action: "fill",
            provider: "openai",
            model: "gpt-4.1-mini",
            prompt: c.prompt,
          });
          assert.equal(r.ok, true, r.error);
          assert.equal(
            r.result.failed.length,
            0,
            JSON.stringify(r.result.failed),
          );
          assert.ok(r.result.verified > 0);
          for (const [key, value] of Object.entries(c.expected)) {
            const el = form.locator(`#${key}`);
            const actual = await el.evaluate((el) =>
              el.matches('input[type="checkbox"],input[type="radio"]')
                ? el.checked
                : el.hasAttribute("aria-checked")
                  ? el.getAttribute("aria-checked") === "true"
                  : el.matches("select[multiple]")
                    ? [...el.selectedOptions].map((o) => o.value)
                    : el.matches("input,textarea,select")
                      ? el.value
                      : el.textContent.trim(),
            );
            assert.deepEqual(
              actual,
              value,
              `${key}: expected ${JSON.stringify(value)}, actual ${JSON.stringify(actual)}`,
            );
          }
          if (c.path === "/react")
            assert.deepEqual(
              JSON.parse(await form.locator("#state").innerText()),
              { name: "Davide Rossi", city: "Milan", enabled: true },
            );
          assert.equal(
            await form.evaluate(() => window.submitted),
            0,
            "The form must not submit",
          );
          await form.screenshot({
            path: `output/${c.path.replaceAll("/", "") || "native"}-${repeat + 1}.png`,
            fullPage: true,
          });
          return {
            aiMs: r.result.elapsedMs,
            verified: r.result.verified,
            changed: r.result.changed,
            skipped: r.result.skipped,
          };
        });
  }
  if (!live) {
    await check('local validation errors are not replaced by a cached successful result', async () => {
      await ui.locator('#prompt').fill('');
      await ui.locator('#fill').click();
      assert.match(await ui.locator('#status').innerText(), /Describe what to fill/);
    });
    await form.reload(); await form.bringToFront(); await ui.reload();
    await ui.locator('#provider').selectOption('groq');
    await ui.locator('#prompt').fill('My name is Davide Rossi. I live in Milan. I am looking for an apartment up to €350,000. Prefer email contact.');
  }
  await ui.locator('body').screenshot({ path: "output/popup.png" });
} finally {
  await context.close();
  await new Promise((resolve) => lab.server.close(resolve));
  await writeFile(
    `output/${live ? "live" : "browser"}-results.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        live,
        provider: live ? "openai" : "mocked",
        results,
      },
      null,
      2,
    ),
  );
}
console.log(
  `${results.filter((r) => r.pass).length}/${results.length} checks passed`,
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
