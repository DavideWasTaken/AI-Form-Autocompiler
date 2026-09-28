# Privacy and execution notes

This document describes the current implementation. The extension executes AI-generated JavaScript on the page after an explicit Fill click.

## What leaves the browser

The extension sends your prompt and a cleaned snapshot directly to the selected provider’s Chat Completions endpoint:

| Provider | Endpoint                                          |
| -------- | ------------------------------------------------- |
| OpenAI   | `https://api.openai.com/v1/chat/completions`      |
| Groq     | `https://api.groq.com/openai/v1/chat/completions` |

The snapshot contains the top-level page’s cleaned body HTML, field labels, current values, field identifiers, title and URL origin/path. The captured URL omits its query and fragment. HTML can include surrounding page text beyond the form. Existing values are included even though the model is instructed to preserve them.

Capture removes scripts, styles, event-handler attributes, embedded frames and selected non-content elements. It excludes hidden content, password/hidden/file inputs, and elements whose autocomplete tokens identify credit-card data or one-time codes. Open shadow roots are included when visible. These filters do not recognize every kind of private information: ordinary text, labels, visible values and URL paths may still contain sensitive data.

The API key is sent to the chosen provider as the request’s authorization header. It is not part of the prompt or captured page. There is no project-operated intermediary service or analytics endpoint in the extension. Data processing and retention by the selected provider are governed by that provider’s account settings and policies; local filtering does not control them.

## What the extension stores

| Data                                     | Location and lifetime                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API keys                                 | Chrome session storage, accessible only to trusted extension contexts. They are not saved to local or sync storage. The popup’s Forget action removes the chosen provider’s key.                                                                                                                                       |
| Provider and model preferences           | Chrome local storage, restricted to trusted extension contexts.                                                                                                                                                                                                                                                        |
| Last per-tab outcome                     | Session storage: verification counts, field labels/issues, errors, model, timing and the tab URL used to associate the result with its page. Model-generated issue or error text may contain page information. The associated URL may include the original query/fragment. Closing the tab removes its stored outcome. |
| Undo checkpoint                          | Previous and filled values of the captured fields, held in the page's extension-only isolated world. Never written to extension storage; gone on reload, navigation or tab close. |
| Prompt, captured HTML and generated code | Used while the request runs; not deliberately saved to extension persistent storage. The provider receives the prompt and snapshot.                                                                                                                                                                                    |

The extension does not log keys, prompt bodies, captured HTML or generated code. Test tools create local output files and temporary profiles; their artifacts are a separate development concern, described in [testing.md](testing.md).

## Permissions and execution

The extension requests access to the current site when you click Fill. Chrome may remember that permission; it can be reviewed or revoked in extension settings. The packaged manifest grants provider host access and uses activeTab, scripting, storage and userScripts. Filling only starts from the extension UI; no script is registered to fill pages automatically on navigation.

Generated code runs in the `USER_SCRIPT` world with access to the document and DOM. User-script extension messaging is disabled. The extension API key is not passed into this world, and session storage is restricted to trusted extension contexts. Chrome explains this execution model in its [userScripts documentation](https://developer.chrome.com/docs/extensions/reference/api/userScripts).

This separation protects extension context; it does not make arbitrary generated code safe for the page. The code can inspect or modify page content beyond the snapshot. The model is instructed not to submit, navigate, make network requests or access cookies/storage, but these instructions are not a runtime enforcement boundary. Page event handlers can also react to clicks and input events, including by initiating their own requests.

## What verification does and does not establish

Before execution, the extension checks the current tab URL, targets the captured document, and compares captured field values with live values. Afterward, a separate content-script check compares each valid reported field with the actual DOM value and native validity. Invalid or duplicate report IDs fail verification.

Verification checks the script’s reported fields and highlights each one on the page. It does not audit every side effect of the generated code. **Undo last fill** restores the previous values of changed text, select, checkbox and plain editable fields, including after a partly failed run; fields you edited after the fill are kept, and page actions triggered by the code (for example a click that loads more content) are not reversed. Cancel stops generation before execution; there is no mandatory code preview. After 15 seconds without an execution result, the extension reports uncertainty and blocks another fill until a reload. It cannot forcibly interrupt arbitrary JavaScript, especially a synchronous infinite loop. Reloading or navigating also clears the previous completion summary.

Review the result and submit the form yourself.
