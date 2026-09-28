# Form Autocompiler usability release plan

> For agentic workers: use superpowers:subagent-driven-development. User has approved these improvements and publication. Keep the current checkout and preserve the existing history.

**Goal:** Ship usable setup, reversible supported field edits, visible results and targeted correction; verify external demo forms and available live providers, then publish with factual compatibility notes and no experimental branding.

**Architecture:** Retain prompt + HTML -> generated JavaScript -> immediate execution. Add a trusted isolated-world recovery module holding one tab/document-local transaction in memory, never page values in extension storage. Background orchestrates capture, transaction checkpoints, execution, verification and recovery. Popup exposes readiness, connection test, result scope and undo. Arbitrary generated code remains best effort: undo restores supported field values only and never promises reversing network/page side effects.

**Tech:** Vanilla MV3, userScripts, Node tests, Playwright.

## Contracts and ownership
- Recovery module `src/recovery.js`: exported self-contained `manageRecovery(action, payload)` runs via scripting in ISOLATED world on pinned documentId. Actions: begin `{snapshot}`, finish `{report?}` measures actual diffs, undo, status, clear. Return serializable summary `{canUndo, changed, restored?, conflicts?, unsupported?, fields:[{id,label,status}]}`. Internal state retains original node references + before/after values so recapture cannot remap IDs; never overwrite user edits made after fill. Outline markers must be removable without clobbering preexisting inline styles. Native text/select/checkbox and text-only contenteditable supported; custom widgets/radio limitations explicit.
- Popup/background API: status adds `recovery` summary. `undo` action returns recovery summary. `check-provider` accepts provider,model and uses saved key; returns `{model, elapsedMs}` on real minimal chat completion (small paid call, no page data). fill optionally accepts `scope: 'all'|'empty'|'failed'`, default all. Empty/failed scope constrains snapshot target fields; prompt can still explicitly correct chosen fields in all scope. Capture context remains visible, generated code instructed to modify only target IDs; no absolute guarantee for arbitrary DOM code.
- Provider/UI owner: `src/provider.js`, `src/popup.{html,css,js}`, provider tests. Export `checkProvider` with same timeout/error redaction as generation, no raw provider errors. Keep existing IDs/test-compatible Save behavior. Guided check list, connection button, scope selector, undo + result legend. Remove LAB/experimental branding. Do not edit background/recovery/browser harness.
- Recovery owner: `src/recovery.js`, `tests/recovery.test.js`, optional capture exclusion of extension overlays only if necessary; coordinate before editing other files.
- Root: background integration, scope filtering module/tests, browser regression, release docs/screenshots/version/history/CI.
- External verification owner: new `tests/external.mjs` and ignored evidence, limited official/public form demo pages with synthetic data; prohibit submission at network/form layer. Actual extension with live Groq and OpenAI if available, keys only via authorized local env in memory, never print/store. Record third-party limitations honestly. Do not submit external forms. No edits to root browser harness.

## Chunk 1: implementation and regression
- [ ] Write failing tests for connection response/error/timeout and recovery conflicts/native events/navigation semantics.
- [ ] Implement provider check + guided popup UI.
- [ ] Implement document-scoped undo and non-destructive field highlighting.
- [ ] Integrate begin/finish also on partial execution failures, status and undo locking, document pinning and same-URL navigation invalidation.
- [ ] Add empty/failed scope, reject zero applicable fields before paid call, clear stale scope on navigation; test preserving existing values and modified-after-fill conflicts.
- [ ] Run unit and browser integration suite including new features.

## Chunk 2: real-world evidence and publication
- [ ] Run real external demo-form checks without submission; distinguish live provider, deterministic code and plain DOM coverage.
- [ ] Attempt real OpenAI request once with authorized key; stop quota failures and ask only for necessary user input while other work continues.
- [ ] Re-run meaningful live Groq cases for updated runtime; check native site permission path if tooling permits, otherwise state exact remaining limit.
- [ ] Independent spec/quality review, fix findings.
- [ ] Update screenshots, README, privacy/test docs and version; remove experimental branding while preserving factual limitations and unavailable-provider evidence.
- [ ] Scan tracked files and new commits for credentials/private artifacts, commit as DavideWasTaken, push main, update GitHub description and verify remote CI.
