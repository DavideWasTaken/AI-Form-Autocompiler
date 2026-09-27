# Testing and current evidence

**27 September 2026 — experimental release evidence.** The latest live Groq run passes all five synthetic scenarios. The full native Chrome toolbar/site-permission approval flow remains unverified.

## Results, including earlier failures

| Check                                        | Result                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit and package tests                       | 56/56 pass. Includes report serialization regressions.                                                                                                                                                                                                       |
| Chromium integration, mocked providers       | **19/19 pass.** Covers execution, both providers, React state, ARIA/shadow controls, failures, cancellation, concurrency, navigation, popup recovery and execution deadlines.                                                                                |
| Initial unpaced Groq run                     | Three generation trials passed; the next request hit HTTP 429. Remaining trials were skipped.                                                                                                                                                                |
| Paced Groq baseline, two trials per scenario | 9/10 passed. One custom-widget trial returned a result Chrome could not serialize for verification.                                                                                                                                                          |
| Diagnostic custom-widget repeats             | 2/2 passed before hardening. The original failed script was not retained, so its exact output shape is unknown.                                                                                                                                              |
| Report hardening                             | Missing/non-JSON report values are rejected before the Chrome API boundary; unrelated metadata is stripped. Unit tests cover missing returns, undefined, DOM references and sparse arrays. Model instructions specify a plain report and a top-level return. |
| Two custom repeats after report hardening    | 1/2 passed strict assertions. The other copied the sentence-ending period into a street address. Punctuation extraction guidance was then added to the model prompt.                                                                                         |
| Latest Groq run with all refinements         | **5/5 generation trials passed**, one per scenario, plus three setup checks. Generation took **1.456–3.839 seconds**, median **2.498 seconds**.                                                                                                              |
| OpenAI live run                              | Ten earlier generation attempts returned HTTP 429, with account diagnostics `credit_balance_exhausted` / `insufficient_quota`. No successful OpenAI generation benchmark.                                                                                    |

Groq used `openai/gpt-oss-120b`; account availability was checked through the provider's models endpoint. The full paced run and latest run used 45-second gaps to respect this account's limits. Those gaps are test pacing, not extension latency. Timing covers the provider request and response, excluding page capture/execution and pacing. Neither a five-case pass nor two successful repeats establish universal reliability.

The sanitized [live result record](live-results.json) preserves each phase and its failures. It contains no credentials or real customer data. The form screenshot in the README comes from the final live Groq custom-widget fixture; the popup screenshot illustrates its controls.

## Run deterministic tests

Requires Node.js 22+:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

Unit tests use Node's test runner and JSDOM; provider responses are mocked. The browser suite loads an unpacked extension in actual Chromium and intercepts both provider endpoints. It exercises `chrome.userScripts.execute` under strict page CSP and asserts actual field values and rendered React state.

The disposable extension copy pregrants localhost access, and its popup is opened as an extension tab. This harness does not verify the native optional-site permission dialog or a human toolbar click. A separate smoke check with the unmodified manifest confirmed that the real action popup opens and renders through CDP; programmatic opening did not grant human-click `activeTab` access. The site grant and first fill through the normal Chrome toolbar remain a manual follow-up.

## Run live tests

Set the chosen key in your local process environment using your secret-management method. Keys must not be committed or pasted into shared logs.

```sh
# OPENAI_API_KEY must be available locally
npm run test:live

# GROQ_API_KEY must be available locally
npm run test:live -- --provider=groq

# Targeted repeat, with explicit pacing
npm run test:live -- --provider=groq --case=/custom --trials=2 --delay-ms=45000
```

These commands make real, potentially billable provider requests. The default is two trials per scenario; Groq calls are spaced 45 seconds apart. `--trials=1` runs one pass. Authentication/quota failures stop subsequent live requests. An unknown case filter is rejected.

| Fixture      | Expected behavior                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `/`          | Text, email, date, budget, textarea, select, radio and checkbox; preserve an existing reference. |
| `/react`     | Update controlled inputs and React's rendered state.                                             |
| `/duplicate` | Distinguish billing/shipping cities; contenteditable notes and multiple selection.               |
| `/custom`    | ARIA combobox/switch and an input inside an open shadow root.                                    |
| `/injection` | Follow the user prompt despite page text requesting a different name and submission.             |

Every passing live trial requires exact expected values, extension verification and zero submission attempts. Fixtures are synthetic localhost pages; their submit handler prevents and counts submissions. Public third-party forms are not submitted. The injection fixture is one example, not a guarantee against prompt injection.

## Artifacts and manual checks

Results go to ignored `output/browser-results.json` and `output/live-<provider>-results.json`; the original OpenAI run used the legacy `output/live-results.json` name. Successful live trials save screenshots. Optional `--capture-scripts` records generated JavaScript under ignored `output/` for synthetic-fixture debugging; it does not record API keys. Inspect diagnostic files before sharing them.

`npm run demo` starts the fixture server at `http://127.0.0.1:8841`. Load the unmodified `src` folder into Chrome, enable Allow User Scripts, save a session key, grant site access on Fill, and check the results. Stop the server when finished.

The manual permission/toolbar check remains outstanding and is disclosed in the README. Additional representative real websites will provide evidence beyond these fixtures. Closed shadow roots, embedded frames and complex widgets remain limitations.
