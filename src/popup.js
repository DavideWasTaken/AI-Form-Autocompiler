import { PROVIDERS } from "./provider.js";
const $ = (id) => document.getElementById(id);
let tab;
let pollTimer;
let busy = false;
let testing = false;
let hasKey = false;
let recovery;
const status = (text, kind = "") => {
  $("status").textContent = text;
  $("status").dataset.kind = kind;
};
function updateControls() {
  $("fill").disabled = busy || testing;
  $("check-provider").disabled = busy || testing || !hasKey;
  $("undo").disabled = busy || testing || !recovery?.canUndo;
  $("clear-highlights").disabled = busy || testing;
  $("provider").disabled = busy || testing;
  $("model").disabled = busy || testing;
  $("scope").disabled = busy || testing;
  $("save-key").disabled = busy || testing;
  $("forget-key").disabled = busy || testing;
}
function showRecovery(value) {
  recovery = value;
  const fields = value?.fields || [];
  $("recovery").hidden = !fields.length && !value?.canUndo;
  $("scope-failed").disabled = !fields.some(field => field.status === "failed");
  if ($("scope").value === "failed" && $("scope-failed").disabled) $("scope").value = "all";
  $("field-results").replaceChildren();
  for (const field of fields) {
    const li = document.createElement("li");
    li.textContent = `${field.label || field.id} · ${field.status}${field.undoSupported === false ? " · undo unavailable" : ""}`;
    if (["verified", "failed", "skipped", "changed", "conflict", "unsupported"].includes(field.status)) li.className = field.status;
    $("field-results").append(li);
  }
  updateControls();
}
function ready(id, text, value) {
  $(id).textContent = text;
  $(id).dataset.ready = String(value);
}
async function refreshSite() {
  if (!tab?.url || !/^https?:\/\//.test(tab.url)) {
    ready("ready-site", "Site access · open a web page with a form", false);
    return;
  }
  const allowed = await chrome.permissions.contains({ origins: [`${new URL(tab.url).origin}/*`] });
  ready("ready-site", allowed ? "Site access · ready" : "Site access · click Fill to grant access", allowed);
}
function showOutcome(response) {
  $("issues").replaceChildren();
  $("issues").hidden = true;
  if (!response?.ok) {
    status(response?.error || "Extension did not respond.", "error");
    return;
  }
  const r = response.result;
  if (r.recovery) showRecovery(r.recovery);
  const issues = [...r.failed, ...r.skipped];
  if (r.frameCount) issues.push("Embedded frames were not processed.");
  status(
    `${r.verified} values verified · ${r.changed} changed\n${(r.elapsedMs / 1000).toFixed(1)}s AI generation · ${r.model}${r.verified === 0 ? "\nNo fields verified. Check the page and adjust the prompt." : ""}${r.failed.length ? "\nSome fields could not be verified." : ""}`,
    r.verified > 0 && !r.failed.length ? "success" : "error",
  );
  for (const item of issues) {
    const li = document.createElement("li");
    li.textContent = item;
    $("issues").append(li);
  }
  $("issues").hidden = !issues.length;
}
async function trackJob() {
  clearTimeout(pollTimer);
  try {
    const response = await chrome.runtime.sendMessage({
      action: "status",
      tabId: tab?.id,
    });
    const r = response?.result;
    if (!response?.ok) throw new Error(response?.error || "Extension did not respond.");
    busy = Boolean(r?.busy);
    $("setup").hidden = Boolean(r?.available);
    ready("ready-scripts", r?.available ? "User scripts · ready" : "User scripts · enable in extension settings", Boolean(r?.available));
    showRecovery(r?.recovery);
    if (r?.busy) {
      $("fill").disabled = true;
      $("cancel").hidden = r.phase !== "generating";
      status(
        r.phase === "uncertain"
          ? "Execution did not finish. Refresh the page before trying again."
          : r.phase === "checking-provider"
            ? "Testing provider connection…"
          : r.phase === "generating"
            ? "Generating JavaScript…"
            : "Executing and verifying…",
      );
      pollTimer = setTimeout(trackJob, 500);
    } else {
      $("cancel").hidden = true;
      if (r?.outcome) showOutcome(r.outcome);
      // Current document recovery takes precedence over the saved fill outcome.
      showRecovery(r?.recovery);
    }
    updateControls();
  } catch (error) {
    busy = false;
    updateControls();
    $("cancel").hidden = true;
    status(error.message, "error");
  }
}
async function refreshKey() {
  const { apiKeys = {} } = await chrome.storage.session.get("apiKeys");
  const has = Boolean(apiKeys[$("provider").value]);
  hasKey = has;
  ready("ready-key", has ? "API key · saved for this session" : "API key · add and save below", has);
  $("key-status").textContent = has ? "· saved for session" : "· needed";
  $("credentials").open = !has;
  $("api-key").value = "";
  updateControls();
}
async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { preferences = {} } = await chrome.storage.local.get("preferences");
  $("provider").value = PROVIDERS[preferences.provider]
    ? preferences.provider
    : "groq";
  $("model").value = preferences.model || PROVIDERS[$("provider").value].model;
  await refreshKey();
  await refreshSite();
  await trackJob();
}
$("provider").addEventListener("change", () => {
  $("connection-status").textContent = "Not tested";
  $("model").value = PROVIDERS[$("provider").value].model;
  refreshKey();
});
$("model").addEventListener("input", () => { $("connection-status").textContent = "Not tested"; });
$("check-provider").addEventListener("click", async () => {
  testing = true;
  updateControls();
  $("connection-status").textContent = "Testing…";
  try {
    const response = await chrome.runtime.sendMessage({ action: "check-provider", provider: $("provider").value, model: $("model").value.trim() });
    if (!response?.ok) throw new Error(response?.error || "Extension did not respond.");
    $("connection-status").textContent = `Connected · ${(response.result.elapsedMs / 1000).toFixed(1)}s`;
    status(`Connection confirmed with ${response.result.model}.`, "success");
  } catch (error) {
    $("connection-status").textContent = "Connection failed";
    status(error.message, "error");
  } finally {
    testing = false;
    updateControls();
  }
});
$("undo").addEventListener("click", async () => {
  busy = true;
  updateControls();
  try {
    const response = await chrome.runtime.sendMessage({ action: "undo", tabId: tab?.id });
    if (!response?.ok) throw new Error(response?.error || "Extension did not respond.");
    const r = response.result;
    showRecovery(r);
    status(`${r.restored || 0} fields restored${r.conflicts ? ` · ${r.conflicts} later edits kept` : ""}${r.unsupported ? ` · ${r.unsupported} unsupported` : ""}. Review the page.`, r.conflicts || r.unsupported ? "" : "success");
  } catch (error) {
    status(error.message, "error");
  } finally {
    busy = false;
    updateControls();
  }
});
$("clear-highlights").addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ action: "clear-highlights", tabId: tab?.id });
    if (!response?.ok) throw new Error(response?.error || "Extension did not respond.");
    status("Field highlights cleared.");
  } catch (error) { status(error.message, "error"); }
});
$("save-key").addEventListener("click", async () => {
  const key = $("api-key").value.trim();
  if (!key) {
    status("Enter a key first.", "error");
    return;
  }
  const { apiKeys = {} } = await chrome.storage.session.get("apiKeys");
  apiKeys[$("provider").value] = key;
  await chrome.storage.session.set({ apiKeys });
  await refreshKey();
  $("connection-status").textContent = "Not tested";
  status("Key saved for this browser session.");
});
$("forget-key").addEventListener("click", async () => {
  const { apiKeys = {} } = await chrome.storage.session.get("apiKeys");
  delete apiKeys[$("provider").value];
  await chrome.storage.session.set({ apiKeys });
  await refreshKey();
  $("connection-status").textContent = "Not tested";
  status("Key removed.");
});
$("settings").addEventListener("click", () =>
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }),
);
$("cancel").addEventListener("click", async () => {
  const r = await chrome.runtime.sendMessage({
    action: "cancel",
    tabId: tab?.id,
  });
  status(
    r?.result?.cancelled
      ? "Cancelling generation…"
      : "Execution has started and cannot be cancelled. Check the page.",
  );
});
$("fill").addEventListener("click", async () => {
  let jobSent = false;
  $("issues").hidden = true;
  $("issues").replaceChildren();
  try {
    if (!tab?.url || !/^https?:\/\//.test(tab.url))
      throw new Error("Open a web page with a form first.");
    const prompt = $("prompt").value.trim();
    if (!prompt) throw new Error("Describe what to fill first.");
    // This request is made directly from the click gesture, before any await.
    const url = new URL(tab.url);
    const allowed = await chrome.permissions.request({
      origins: [`${url.origin}/*`],
    });
    if (!allowed) throw new Error("Site access is required to fill this page.");
    ready("ready-site", "Site access · ready", true);
    const provider = $("provider").value;
    const model = $("model").value.trim();
    await chrome.storage.local.set({ preferences: { provider, model } });
    busy = true;
    updateControls();
    $("cancel").hidden = false;
    status(
      "Reading page → generating JavaScript → filling…\nKeep this popup and the page open.",
    );
    jobSent = true;
    const response = await chrome.runtime.sendMessage({
      action: "fill",
      tabId: tab.id,
      prompt,
      provider,
      model,
      scope: $("scope").value,
    });
    showOutcome(response);
  } catch (error) {
    status(error.message, "error");
  } finally {
    busy = false;
    updateControls();
    $("cancel").hidden = true;
    if (jobSent) await trackJob();
  }
});
init().catch((error) => status(error.message, "error"));
