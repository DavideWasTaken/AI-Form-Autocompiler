import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { capturePage } from "../src/capture.js";
import { manageRecovery } from "../src/recovery.js";
function page(html) {
  const w = new JSDOM(html, { url: "https://example.test", runScripts: "outside-only", pretendToBeVisual: true }).window;
  w.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 30 }];
  const call = (action, payload = {}) => JSON.parse(JSON.stringify(w.eval(`(${manageRecovery.toString()})(${JSON.stringify(action)},${JSON.stringify(payload)})`)));
  const capture = (id = "first") => w.eval(`(${capturePage.toString()})(${JSON.stringify(id)})`);
  return { w, call, capture };
}

test("partial execution is recoverable without a report and summaries omit values", () => {
  const { w, call, capture } = page('<input aria-label="Name" value="private-before">');
  call("begin", { snapshot: capture() });
  w.document.querySelector("input").value = "private-after";
  const done = call("finish");
  assert.equal(done.changed, 1);
  assert.equal(done.canUndo, true);
  assert.equal(done.fields[0].status, "changed");
  assert.doesNotMatch(JSON.stringify(done), /private-/);
  assert.equal(call("undo").restored, 1);
  assert.equal(w.document.querySelector("input").value, "private-before");
  assert.equal(call("status").canUndo, false);
});

test("undo preserves later edits and skips removed fields without restoring replacement nodes", () => {
  const { w, call, capture } = page('<input value="one"><input value="two"><input value="three">');
  call("begin", { snapshot: capture() });
  const nodes = [...w.document.querySelectorAll("input")];
  nodes.forEach((el) => el.value = "filled");
  call("finish");
  nodes[0].value = "user edit";
  const replacement = nodes[1].cloneNode();
  nodes[1].replaceWith(replacement);
  const result = call("undo");
  assert.equal(result.restored, 1);
  assert.equal(result.conflicts, 1);
  assert.equal(result.fields[1].status, "removed");
  assert.equal(nodes[0].value, "user edit");
  assert.equal(replacement.value, "filled");
  assert.equal(nodes[2].value, "three");
});

test("native undo dispatches input/change and bypasses instance value setters", () => {
  const { w, call, capture } = page('<input value="old"><textarea>old</textarea><input type="checkbox"><select multiple><option value="same" selected>A</option><option value="same">B</option></select>');
  call("begin", { snapshot: capture() });
  const nodes = [...w.document.querySelectorAll("input,textarea,select")];
  nodes[0].value = nodes[1].value = "new";
  nodes[2].checked = true;
  nodes[2].indeterminate = true;
  nodes[3].options[0].selected = false;
  nodes[3].options[1].selected = true;
  call("finish");
  Object.defineProperty(nodes[0], "value", { get: Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, "value").get, set() { throw new Error("framework instance setter"); }, configurable: true });
  const events = [];
  nodes.forEach((el, index) => ["input", "change"].forEach((type) => el.addEventListener(type, () => events.push(`${index}:${type}`))));
  assert.equal(call("undo").restored, 4);
  assert.equal(nodes[0].value, "old");
  assert.equal(nodes[1].value, "old");
  assert.equal(nodes[2].checked, false);
  assert.equal(nodes[2].indeterminate, false);
  assert.equal(nodes[3].options[0].selected, true);
  assert.equal(nodes[3].options[1].selected, false);
  assert.equal(events.length, 8);
});

test("recapture and shadow roots retain node identity while summaries use current markers", () => {
  const { w, call, capture } = page('<input value="old"><div id="host"></div>');
  const shadow = w.document.querySelector("#host").attachShadow({ mode: "open" });
  shadow.innerHTML = '<input value="shadow old">';
  call("begin", { snapshot: capture() });
  w.document.querySelector("input").value = "new";
  shadow.querySelector("input").value = "shadow new";
  call("finish");
  const recaptured = capture("second");
  assert.equal(call("status").fields[0].id, recaptured.fields[0].id);
  assert.equal(call("undo").restored, 2);
  assert.equal(shadow.querySelector("input").value, "shadow old");
});

test("report outcomes highlight fields without modifying inline styles, and clear removes markers", () => {
  const { w, call, capture } = page('<input style="outline: 7px dotted pink !important" value="a"><input value="b"><input value="c"><input value="d">');
  const snapshot = capture();
  call("begin", { snapshot });
  const nodes = [...w.document.querySelectorAll("input")];
  nodes[0].value = "new";
  nodes[1].value = "actual";
  nodes[3].value = "unreported";
  const result = call("finish", { report: { filled: [{id:snapshot.fields[0].id,value:"new"},{id:snapshot.fields[1].id,value:"wrong"}], skipped: [snapshot.fields[2].id] } });
  assert.deepEqual(result.fields.map((field) => field.status), ["verified", "failed", "skipped", "failed"]);
  assert.equal(nodes[0].style.cssText, "outline: 7px dotted pink !important;");
  assert.ok(w.document.querySelector("style"));
  call("clear");
  assert.equal(w.document.querySelector("style"), null);
  assert.deepEqual(nodes[0].getAttributeNames().sort(), ["data-af-id", "style", "value"]);
  assert.equal(call("status").canUndo, true);
  assert.equal(call("undo").restored, 3);
});

test("radios and custom widgets are explicitly unsupported; rich contenteditable markup survives", () => {
  const { w, call, capture } = page('<input type="radio" name="r" checked><input type="radio" name="r"><div role="checkbox" aria-checked="false"></div><div contenteditable="true"><b>old</b></div><div contenteditable="true">plain old</div>');
  call("begin", { snapshot: capture() });
  const nodes = [...w.document.querySelectorAll("input,div")];
  nodes[1].checked = true;
  nodes[2].setAttribute("aria-checked", "true");
  nodes[3].querySelector("b").textContent = "new";
  nodes[4].textContent = "plain new";
  const done = call("finish");
  assert.equal(done.unsupported, 4);
  assert.equal(call("undo").restored, 1);
  assert.equal(nodes[1].checked, true);
  assert.equal(nodes[3].innerHTML, "<b>new</b>");
  assert.equal(nodes[4].textContent, "plain old");
});

test("contenteditable gaining markup and changed select options are skipped as conflicts", () => {
  const { w, call, capture } = page('<div contenteditable="true">old</div><select><option selected>A</option><option>B</option></select>');
  call("begin", { snapshot: capture() });
  const edit = w.document.querySelector("div"), select = w.document.querySelector("select");
  edit.textContent = "new";
  select.selectedIndex = 1;
  call("finish");
  edit.innerHTML = "<b>new</b>";
  select.options[0].replaceWith(select.options[0].cloneNode(true));
  const result = call("undo");
  assert.equal(result.restored, 0);
  assert.equal(result.conflicts, 2);
  assert.equal(edit.innerHTML, "<b>new</b>");
});

test("transactions remain document local and a new begin replaces the previous undo", () => {
  const first = page('<input value="original">'), second = page('<input>');
  first.call("begin", { snapshot: first.capture() });
  const node = first.w.document.querySelector("input");
  node.value = "first fill";
  first.call("finish");
  assert.equal(second.call("status").canUndo, false);
  first.call("begin", { snapshot: first.capture("second") });
  node.value = "second fill";
  first.call("finish");
  first.call("undo");
  assert.equal(node.value, "first fill");
});

test("stale begin refuses execution and retains the previous undo transaction", () => {
  const { w, call, capture } = page('<input value="original">');
  call("begin", { snapshot: capture() });
  const node = w.document.querySelector("input");
  node.value = "first fill";
  call("finish");
  const stale = capture("second");
  node.value = "user edit";
  assert.throws(() => call("begin", { snapshot: stale }), /changed|stale/i);
  assert.equal(call("status").changed, 1);
  assert.equal(call("undo").conflicts, 1);
});

test("undo verifies final values after all framework event handlers have run", () => {
  const { w, call, capture } = page('<input value="first old"><input value="second old">');
  call("begin", { snapshot: capture() });
  const [first, second] = w.document.querySelectorAll("input");
  first.value = second.value = "filled";
  call("finish");
  second.addEventListener("change", () => { first.value = "framework update"; });
  const result = call("undo");
  assert.equal(result.restored, 1);
  assert.equal(result.conflicts, 1);
  assert.equal(first.value, "framework update");
});

test("finish cannot absorb later edits and discard releases the checkpoint", () => {
  const { w, call, capture } = page('<input value="old">');
  call("begin", { snapshot: capture() });
  const node = w.document.querySelector("input");
  node.value = "filled";
  call("finish");
  node.value = "user edit";
  call("finish");
  assert.equal(call("undo").conflicts, 1);
  assert.equal(call("discard").canUndo, false);
  assert.equal(call("status").fields.length, 0);
  assert.equal(w.document.querySelector("style"), null);
});

test("checkbox undo uses native activation so React-style click handlers update application state", () => {
  const { w, call, capture } = page('<input type="checkbox">');
  call("begin", { snapshot: capture() });
  const node = w.document.querySelector("input");
  node.checked = true;
  call("finish");
  let applicationChecked = true, clickCount = 0;
  node.addEventListener("click", () => { applicationChecked = node.checked; clickCount++; });
  assert.equal(call("undo").restored, 1);
  assert.equal(applicationChecked, false);
  assert.equal(clickCount, 1);
});

test("unsupported undo fields still expose verified/failed results and safe highlights", () => {
  const { w, call, capture } = page('<div role="checkbox" aria-checked="false"></div><div role="combobox">old</div><input type="radio">');
  const snapshot = capture();
  call("begin", { snapshot });
  const nodes = w.document.querySelectorAll("div");
  nodes[0].setAttribute("aria-checked", "true");
  nodes[1].textContent = "actual";
  const result = call("finish", { report: { filled: [{id:snapshot.fields[0].id,value:true},{id:snapshot.fields[1].id,value:"expected"}], skipped: [] } });
  assert.deepEqual(result.fields.map((field) => field.status), ["verified", "failed", "skipped"]);
  assert.ok(result.fields.every((field) => field.undoSupported === false));
  assert.equal(result.unsupported, 2);
  assert.ok(nodes[1].getAttributeNames().some((attr) => attr.startsWith("data-af-recovery-")));
});
