# Generic AI Form Autocompiler implementation plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. User approved implementation; no publication until real testing is convincing.

**Goal:** Fill the current web page from a natural-language prompt using AI-generated JavaScript, with OpenAI and Groq.

**Architecture:** A Chrome 138+ MV3 extension captures a cleaned HTML snapshot on explicit user action. A service worker calls the selected provider, then executes the returned JavaScript with chrome.userScripts.execute in USER_SCRIPT world (messaging disabled), pinned to the captured document. A popup configures provider/model/session API key and triggers filling without mandatory preview. Verification compares actual DOM state and returned expectations; script completion alone is not success. No automatic submission in the generated-code contract; arbitrary code is not claimed to be sandboxed from the page.

**Tech Stack:** Vanilla JS modules, Chrome userScripts/scripting/storage/activeTab, Node test runner, Playwright browser testing. Fresh local copy; original private repo untouched.

## Chunk 1: Provider and script contract
- [x] Add failing unit tests in tests/provider.test.js for request structure, provider allowlist, HTTP 401/429/5xx, malformed/empty/truncated output, cancellation, timeout, code fences and refusal.
- [x] Implement src/provider.js with fixed official API endpoints, defaults Groq openai/gpt-oss-120b and OpenAI gpt-4.1-mini (configurable), max output length, bounded requests; no execution retries.
- [x] Export buildMessages(snapshot,prompt), generateScript({provider,model,apiKey,prompt,snapshot,signal,fetchImpl}) returning {code,model,elapsedMs}; no data/key logging.
- [x] Contract: return JS body for async function, HTML is untrusted data, never navigate/submit/fetch, don't invent data, preserve existing fields unless prompt explicitly replaces them, dispatch native setter/input/change events, handle ARIA widgets, return {filled:[{id,value}],skipped:[string]}. IDs are data-af-id assigned to live fields. Genuine JS, not a restricted action DSL.
- [x] npm test must pass after implementation.

## Chunk 2: Browser execution and UI
- [x] Create manifest.json (extension at src/), background.js, capture.js, execution.js, popup.html/css/js; copy only existing icons.
- [x] Capture body clone without scripts/styles/hidden/password/payment fields/event handlers/URL query; include live form values and open shadow DOM representation. Cap page size visibly; fail instead of silently dropping fields. Mark supported visible controls with stable per-run data-af-id.
- [x] Use per-site optional host permission (user click), activeTab, official provider host permissions. Check Allow User Scripts before paid API calls.
- [x] Keep keys in chrome.storage.session trusted contexts; options nonsecret in local storage. No hardcoded config or persisted prompts/HTML/scripts.
- [x] Prevent concurrent fills per tab; abort provider requests on cancel; don't replay generated scripts on failure. Reject stale URL/document/fields before execution; verify actual values and constraint validity after execution; report partial/failure honestly.
- [x] No automatic execution on page load. Only top frame supported initially; disclose iframe/closed-shadow limitations.

## Chunk 3: Real verification and documentation
- [x] Tests before implementations for capture/verifier behaviors, scripts runtime errors and stale documents.
- [x] Build fixture pages covering native HTML, React controlled inputs, dynamic/ARIA widgets, duplicate labels, existing data, invalid values, unsupported/hidden inputs, prompt-injection text, large pages.
- [x] Launch actual Chromium extension; verify toggle, provider key settings, successful and failed provider calls, userScripts execution (including strict page CSP), no submission, errors and result display.
- [ ] Run live OpenAI and Groq (when local key is available) on synthetic fixtures, measure latency and exact expected field values across repeated trials; record passes/failures, never fabricate provider coverage. No external form submissions.
- [x] Independent spec/code review; fix blockers and rerun relevant gates.
- [x] README setup with screenshots, model/key/provider choice, data flow, experimental limitations, usage risk; docs/testing.md separates deterministic tests from live AI results. Add MIT license and ignores for secrets/artifacts.
- [x] Commit locally with DavideWasTaken / 85361102+DavideWasTaken@users.noreply.github.com only after verification. Do not push or publish this turn.

## Verification checkpoint
- 54 unit/package tests and 18 actual Chromium checks with mocked providers pass.
- OpenAI live generation: blocked by HTTP 429 credit_balance_exhausted / insufficient_quota. User selected OpenAI-only live testing; Groq live trial is deferred.
- Actual unmodified-manifest toolbar popup rendering smoke passed via CDP. Native optional-site permission approval remains a manual release gate.
- Screenshots inspected; secret scan required before local commit. No push or publication.
