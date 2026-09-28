import { capturePage } from "./capture.js";
import { executeBody, verifyReport, awaitExecution } from "./execution.js";
import { generateScript, checkProvider } from "./provider.js";
import { manageRecovery } from "./recovery.js";

const jobs = new Map();
const ready = Promise.all([
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
]);
async function recover(tabId, action, payload = {}, documentId) {
  const replies = await chrome.scripting.executeScript({
    target: documentId ? {tabId, documentIds:[documentId]} : {tabId, frameIds:[0]},
    func: manageRecovery,
    args: [action, payload],
  });
  if (!replies[0]?.result) throw new Error("Could not access this page's recovery state.");
  return replies[0].result;
}
async function scriptsReady() {
  try {
    if (!chrome.userScripts?.execute) throw new Error();
    await chrome.userScripts.getScripts();
  } catch {
    throw new Error(
      "Enable Allow User Scripts in the extension Details at chrome://extensions, then reopen this popup.",
    );
  }
}
async function handle(message) {
  await ready;
  if (message.action === "status") {
    let available = true;
    try {
      await scriptsReady();
    } catch {
      available = false;
    }
    const job = jobs.get(message.tabId);
    const key = `result:${message.tabId}`;
    const stored = (await chrome.storage.session.get(key))[key];
    const tab = await chrome.tabs.get(message.tabId).catch(() => null);
    const recovery = tab && /^https?:/.test(tab.url || "") ? await recover(message.tabId,"status").catch(()=>null) : null;
    return {
      available,
      busy: Boolean(job),
      phase: job?.phase,
      outcome: stored?.url === tab?.url ? stored.outcome : null,
      recovery,
    };
  }
  if (message.action === "check-provider") {
    const {apiKeys={}} = await chrome.storage.session.get("apiKeys");
    return checkProvider({provider:message.provider,model:message.model,apiKey:apiKeys[message.provider]});
  }
  if (["undo", "clear-highlights"].includes(message.action)) {
    const tabId = message.tabId;
    if (!Number.isInteger(tabId)) throw new Error("Open a web page first.");
    if (jobs.has(tabId)) throw new Error("Wait for the current fill to finish before changing its result.");
    const job = {phase:"recovering"};
    jobs.set(tabId,job);
    try {
      const result = await recover(tabId,message.action === "undo" ? "undo" : "clear");
      if (message.action === "undo") await chrome.storage.session.remove(`result:${tabId}`);
      return result;
    } finally { if(jobs.get(tabId)===job) jobs.delete(tabId); }
  }
  if (message.action === "cancel") {
    const job = jobs.get(message.tabId);
    if (job?.phase === "generating") {
      job.controller.abort();
      return { cancelled: true };
    }
    return { cancelled: false };
  }
  if (message.action !== "fill") throw new Error("Unknown action");
  const { tabId, prompt, provider, model } = message;
  const scope = message.scope || "all";
  if (!["all","empty","failed"].includes(scope)) throw new Error("Choose a valid fill scope.");
  if (!Number.isInteger(tabId) || typeof prompt !== "string" || !prompt.trim())
    throw new Error("Open a web page and enter instructions.");
  if (jobs.has(tabId))
    throw new Error("A fill is already in progress for this tab.");
  const job = { controller: new AbortController(), phase: "generating" };
  jobs.set(tabId, job);
  const resultKey = `result:${tabId}`;
  await chrome.storage.session.remove(resultKey);
  job.keepAlive = setInterval(
    () => chrome.runtime.getPlatformInfo().catch(() => {}),
    20000,
  );
  let startedUrl;
  let recoveryDocument;
  let executionStarted = false;
  try {
    await scriptsReady();
    const tab = await chrome.tabs.get(tabId);
    startedUrl = tab.url;
    const url = new URL(tab.url);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error(
        "Open a normal HTTP or HTTPS page. Browser settings and extension pages cannot be filled.",
      );
    const keys = await chrome.storage.session.get("apiKeys");
    const apiKey = keys.apiKeys?.[provider];
    if (!apiKey)
      throw new Error("Enter and save an API key for this provider.");
    const previous = scope === "failed" ? await recover(tabId,"status") : null;
    const failedIds = previous?.fields?.filter(field=>field.status === "failed").map(field=>field.id) || [];
    if (scope === "failed" && !failedIds.length) throw new Error("No failed fields remain. Choose another scope.");
    const captures = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      func: capturePage,
      args: [crypto.randomUUID(),100000,{mode:scope,failedIds}],
    });
    const capture = captures[0];
    if (!capture?.result)
      throw new Error("Could not read the form. Refresh the page and retry.");
    const snapshot = capture.result;
    const generated = await generateScript({
      provider,
      model,
      apiKey,
      prompt,
      snapshot,
      signal: job.controller.signal,
    });
    if (job.controller.signal.aborted)
      throw new Error("Cancelled before execution.");
    const current = await chrome.tabs.get(tabId);
    if (current.url !== tab.url)
      throw new Error(
        "The page changed while generating. Try again on the current page.",
      );
    job.phase = "executing";
    await chrome.userScripts.configureWorld({ messaging: false });
    recoveryDocument = capture.documentId;
    await recover(tabId,"begin",{snapshot},recoveryDocument);
    executionStarted = true;
    const executions = await awaitExecution(
      chrome.userScripts.execute({
        target: { tabId, documentIds: [capture.documentId] },
        world: "USER_SCRIPT",
        js: [{ code: executeBody(generated.code, snapshot) }],
      }),
    );
    const execution = executions[0];
    if (execution?.error)
      throw new Error(
        "Generated script failed. Check the page before retrying.",
      );
    if (!execution?.result?.ok)
      throw new Error(
        `Generated script stopped: ${execution?.result?.error || "no result"}. Some fields may have changed.`,
      );
    // Let framework updates settle before independently reading their state.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const checks = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [capture.documentId] },
      func: verifyReport,
      args: [snapshot, execution.result.report],
    });
    if (!checks[0]?.result)
      throw new Error("Could not verify the result. Check the page.");
    const recovery = await recover(tabId,"finish",{report:execution.result.report},recoveryDocument);
    const result = {
      ...checks[0].result,
      elapsedMs: generated.elapsedMs,
      provider,
      model: generated.model,
      frameCount: snapshot.frameCount,
      recovery,
    };
    if (job.navigated) throw new Error("The page changed while filling. Review the current page before trying again.");
    await chrome.storage.session.set({
      [resultKey]: { url: startedUrl, outcome: { ok: true, result } },
    });
    return result;
  } catch (caught) {
    // Navigation aborts generation; report the cause rather than a cancellation.
    const error = job.navigated && job.phase === "generating"
      ? new Error("The page changed while generating. Try again on the current page.")
      : caught;
    if (error.code === "EXECUTION_UNCERTAIN") job.phase = "uncertain";
    if (executionStarted && job.phase !== "uncertain") await recover(tabId,"finish",{},recoveryDocument).catch(()=>{});
    if (!job.navigated) await chrome.storage.session.set({
      [resultKey]: {
        url: startedUrl,
        outcome: {
          ok: false,
          error: String(error?.message || "Unexpected error").slice(0, 500),
        },
      },
    });
    throw error;
  } finally {
    if (job.phase !== "uncertain") {
      clearInterval(job.keepAlive);
      if (jobs.get(tabId) === job) jobs.delete(tabId);
    }
  }
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only the packaged UI can launch jobs. Content and user scripts cannot.
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("popup.html")
  )
    return false;
  handle(message).then(
    (result) => sendResponse({ ok: true, result }),
    (error) =>
      sendResponse({
        ok: false,
        error: String(error?.message || "Unexpected error").slice(0, 500),
      }),
  );
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  const job = jobs.get(tabId);
  job?.controller?.abort();
  clearInterval(job?.keepAlive);
  jobs.delete(tabId);
  chrome.storage.session.remove(`result:${tabId}`);
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading") {
    chrome.storage.session.remove(`result:${tabId}`);
    const job = jobs.get(tabId);
    if (job) {
      job.navigated = true;
      if (job.phase === "generating") job.controller?.abort();
    }
    if (job?.phase === "uncertain") {
      clearInterval(job.keepAlive);
      jobs.delete(tabId);
    }
  }
});
