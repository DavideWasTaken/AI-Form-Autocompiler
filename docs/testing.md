# Testing and current evidence

**Status recorded 27 September 2026: local candidate; publication remains on hold.** Deterministic tests exercise the integration. Successful live AI generation has not yet been established.

## Current results

| Layer                                     | Evidence at this checkpoint                                                                                                                                                          | What it establishes                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and packaging tests                  | **54/54 pass** in `npm test`.                                                                                                                                                        | Request validation, error handling, capture, deadlines and verification behavior under controlled inputs.                                                                                                     |
| Actual Chromium with mocked API responses | **18/18 pass** in `npm run test:browser`.                                                                                                                                            | Extension loading, userScripts toggle, session keys, strict-CSP execution, UI reporting, cancellation, concurrency, navigation/reload, stalled scripts, native/React/ARIA/shadow controls and both providers. |
| Live OpenAI, `gpt-4.1-mini`               | Ten generation trials attempted across five fixtures; all failed with HTTP 429. Account diagnostics reported exhausted credit / `credit_balance_exhausted` and `insufficient_quota`. | Requests reached the provider and the extension surfaced the quota failure. No successful AI filling or latency evidence.                                                                                     |
| Groq                                      | Mocked provider tests only. Live testing was intentionally limited to OpenAI.                                                                                                        | Request construction and deterministic response handling; no live model-quality claim.                                                                                                                        |

The live run’s three setup checks passed, but those are not successful generation trials. Failed-request durations must not be presented as AI completion latency. Screenshots of the UI and synthetic fixtures illustrate the local application; they do not demonstrate live AI accuracy.

## Run deterministic tests

From the repository root, with Node.js 22 or newer:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

`npm test` uses Node’s test runner. Provider tests inject mocked fetch responses and never call OpenAI or Groq. DOM tests use JSDOM. Packaging tests check the extension package.

`npm run test:browser` launches actual Chromium with an unpacked copy of the extension, a temporary browser profile, and a local fixture server. It intercepts OpenAI and Groq requests with deterministic responses. It tests the installed extension’s flow, including the real userScripts switch and script execution; it does not test a model’s ability to understand a form. The disposable extension copy has a localhost permission for automation. The popup is opened as an extension tab; this harness does not verify the native optional-site permission dialog or the toolbar popup itself. Check those with the unmodified `src` manifest before release.

Provider coverage includes both fixed API endpoints and default models, custom models, message and code limits, HTTP failures without raw payload leakage, malformed or incomplete completions, refusals, fences, cancellation and the 25-second deadline. DOM coverage includes sensitive autocomplete tokens, visibility across shadow ancestors, stale markers, native events, rejecting unsupported radio clearing, current textarea values, existing-data changes, invalid native values and invalid or duplicate report IDs.

## Live OpenAI trials

Set `OPENAI_API_KEY` in your local process environment using your usual secret-management method, then run:

```sh
npm run test:live
```

The command refuses to run without the environment variable. It makes real, potentially billable requests using your account. Do not put an actual key in source files, screenshots, committed environment files or shared logs.

The current harness requests `gpt-4.1-mini` and repeats each fixture twice:

After an authentication or quota failure, subsequent live trials are skipped to avoid repeating requests that cannot succeed. The initial quota-blocked run predates that early-stop improvement.

| Fixture                             | Expected behavior                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Native form, `/`                    | Fill text, email, date, number, textarea, select, radio and checkbox controls; preserve the existing reference. |
| React form, `/react`                | Update controlled fields and the rendered React state.                                                          |
| Duplicate labels, `/duplicate`      | Distinguish billing and shipping cities; fill contenteditable notes and a multiple select.                      |
| Custom widgets, `/custom`           | Interact with an ARIA combobox and switch, and fill an input inside an open shadow root.                        |
| Instruction injection, `/injection` | Follow the user’s request while ignoring page text asking for an unrelated replacement and submission.          |

Each successful trial must pass independent field-value assertions, extension verification and a zero-submission check. Tests use synthetic localhost pages and do not submit public third-party forms. The fixture server prevents submission and counts attempts so a generated submit action fails the test.

## Outputs and interpretation

The harness writes machine-readable results to `output/browser-results.json` or `output/live-results.json`. Successful live trials also produce fixture screenshots. Browser profiles and the disposable extension copy are under `output/`. This directory is ignored by Git; inspect artifacts before sharing them.

To inspect the fixtures manually, run `npm run demo` and open `http://127.0.0.1:8841`, with the paths above for each scenario. The command starts a local server; stop it when finished.

Before publication, rerun the current unit, packaging and browser suites, then complete successful live trials with available API credit. Record actual expected-versus-observed values, failures and generation timings. Passing these fixtures still does not imply reliable operation on every website, closed shadow roots or iframe forms.
