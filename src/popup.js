import { PROVIDERS } from "./provider.js";
const $ = (id) => document.getElementById(id);
let tab;
let pollTimer;
const status = (text, kind = "") => {
  $("status").textContent = text;
  $("status").dataset.kind = kind;
};
function showOutcome(response) {
  $("issues").replaceChildren();
  $("issues").hidden = true;
  if (!response?.ok) {
    status(response?.error || "Extension did not respond.", "error");
    return;
  }
  const r = response.result;
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
    if (r?.busy) {
      $("fill").disabled = true;
      $("cancel").hidden = r.phase !== "generating";
      status(
        r.phase === "uncertain"
          ? "Execution did not finish. Refresh the page before trying again."
          : r.phase === "generating"
            ? "Generating JavaScript…"
            : "Executing and verifying…",
      );
      pollTimer = setTimeout(trackJob, 500);
    } else {
      $("fill").disabled = false;
      $("cancel").hidden = true;
      if (r?.outcome) showOutcome(r.outcome);
    }
  } catch (error) {
    $("fill").disabled = false;
    $("cancel").hidden = true;
    status(error.message, "error");
  }
}
async function refreshKey() {
  const { apiKeys = {} } = await chrome.storage.session.get("apiKeys");
  const has = Boolean(apiKeys[$("provider").value]);
  $("key-status").textContent = has ? "· saved for session" : "· needed";
  $("credentials").open = !has;
  $("api-key").value = "";
}
async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const { preferences = {} } = await chrome.storage.local.get("preferences");
  $("provider").value = PROVIDERS[preferences.provider]
    ? preferences.provider
    : "groq";
  $("model").value = preferences.model || PROVIDERS[$("provider").value].model;
  await refreshKey();
  const response = await chrome.runtime.sendMessage({
    action: "status",
    tabId: tab?.id,
  });
  $("setup").hidden = Boolean(response?.result?.available);
  if (response?.result?.busy || response?.result?.outcome) await trackJob();
}
$("provider").addEventListener("change", () => {
  $("model").value = PROVIDERS[$("provider").value].model;
  refreshKey();
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
  status("Key saved for this browser session.");
});
$("forget-key").addEventListener("click", async () => {
  const { apiKeys = {} } = await chrome.storage.session.get("apiKeys");
  delete apiKeys[$("provider").value];
  await chrome.storage.session.set({ apiKeys });
  await refreshKey();
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
    const provider = $("provider").value;
    const model = $("model").value.trim();
    await chrome.storage.local.set({ preferences: { provider, model } });
    $("fill").disabled = true;
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
    });
    showOutcome(response);
  } catch (error) {
    status(error.message, "error");
  } finally {
    $("fill").disabled = false;
    $("cancel").hidden = true;
    if (jobSent) await trackJob();
  }
});
init().catch((error) => status(error.message, "error"));
