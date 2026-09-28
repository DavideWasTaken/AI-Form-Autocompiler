# Testing

Version 2.1.0 · 28 September 2026.

## Results

| Check                                  | Result                                                                                                                                                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and package tests                 | **81/81 pass.** Provider requests and connection test, report serialization, capture, fill scope, undo and conflict handling.                                                                      |
| Chromium integration, mocked providers | **25/25 pass.** Execution under strict CSP, both providers, React state, ARIA/shadow controls, failures, cancellation, concurrency, navigation, popup recovery, undo, retry-failed and empty-only scope. |
| Live Groq, public demo pages           | **3/3 pass** with undo verified: Selenium web form (5 fields), Selenium form page (4 fields), Playwright TodoMVC (1 field). AI generation 1.0–2.9 s.                                             |
| Live Groq, synthetic fixtures          | **5/5 pass**: native controls, React, duplicate labels, ARIA/shadow root, prompt injection. AI generation 1.5–3.8 s, median 2.5 s.                                                                |

All live runs use `openai/gpt-oss-120b` and synthetic data. Public pages are never submitted: the harness blocks form submission and page network requests after load. Timings cover the provider request only; gaps between runs are pacing for rate limits.

Earlier live rounds found two model-output problems, fixed before the runs above: reports Chrome could not serialize (now rejected before the API boundary) and a sentence-ending period copied into a street address (now covered by extraction guidance). The sanitized [live result record](live-results.json) keeps every phase.

## Run deterministic tests

Requires Node.js 22+:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
```

Unit tests use Node's test runner and JSDOM with mocked provider responses. The browser suite loads the unpacked extension in real Chromium, intercepts both provider endpoints and asserts actual field values and rendered React state.

## Run live tests

Set `GROQ_API_KEY` or `OPENAI_API_KEY` in your local environment. Never commit keys or paste them into shared logs.

```sh
# Synthetic fixtures
npm run test:live -- --provider=groq
npm run test:live -- --provider=groq --case=/custom --trials=2 --delay-ms=45000

# Public demo pages, including undo
node tests/external.mjs --provider=groq --undo
node tests/external.mjs --provider=openai --case=selenium-web-form
```

These make real, potentially billable requests. Authentication or quota errors stop the remaining live requests.

| Fixture      | Expected behavior                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `/`          | Text, email, date, budget, textarea, select, radio and checkbox; preserve an existing reference. |
| `/react`     | Update controlled inputs and React's rendered state.                                             |
| `/duplicate` | Distinguish billing/shipping cities; contenteditable notes and multiple selection.               |
| `/custom`    | ARIA combobox/switch and an input inside an open shadow root.                                    |
| `/injection` | Follow the user prompt despite page text requesting a different name and submission.             |

A live trial passes only with exact expected values, extension verification and zero submission attempts.

## Artifacts

Results go to the ignored `output/` folder (`browser-results.json`, `live-<provider>-results.json`, `external-<label>-<provider>-results.json`) together with screenshots. `--capture-scripts` also saves the generated JavaScript for fixture debugging; it never records API keys.

`npm run demo` serves the synthetic forms at `http://127.0.0.1:8841` for trying the unpacked extension by hand.
