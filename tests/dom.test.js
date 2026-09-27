import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { capturePage } from "../src/capture.js";
import { executeBody, verifyReport } from "../src/execution.js";

function page(html) {
  const dom = new JSDOM(html, {
    url: "https://example.test/form?secret=omitted",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.HTMLElement.prototype.getClientRects = function () {
    return this.hidden ? [] : [{ width: 100, height: 30 }];
  };
  return dom.window;
}
function capture(w) {
  return w.eval(`(${capturePage.toString()})('test-run')`);
}
test("button-based ARIA combobox uses its visible selection rather than HTML button.value", async () => {
  const w = page('<button type="button" role="combobox">Choose city</button>');
  const s = capture(w);
  assert.equal(s.fields[0].value, "Choose city");
  const code = `af.get('${s.fields[0].id}').textContent='Milan';return {filled:[{id:'${s.fields[0].id}',value:'Milan'}],skipped:[]}`;
  const result = await w.eval(executeBody(code, s));
  assert.equal(result.ok, true);
  const v = w.eval(
    `(${verifyReport.toString()})(${JSON.stringify(s)},${JSON.stringify(result.report)})`,
  );
  assert.equal(v.verified, 1);
});
function verify(w, s, report) {
  return w.eval(
    `(${verifyReport.toString()})(${JSON.stringify(s)},${JSON.stringify(report)})`,
  );
}
test("capture excludes scripts, hidden secrets and credential values but keeps labels and current text", () => {
  const w = page(
    '<label>Name<input name="name" value="Existing"></label><input type="hidden" value="TOKEN"><input type="password" value="PASSWORD"><script>SECRET</script><div hidden>HIDDEN</div>',
  );
  const s = capture(w);
  assert.equal(s.fields.length, 1);
  assert.equal(s.fields[0].value, "Existing");
  assert.match(s.html, /Name/);
  assert.doesNotMatch(s.html, /SECRET|TOKEN|PASSWORD|HIDDEN/);
  assert.equal(s.url, "https://example.test/form");
});
test("distinct IDs for duplicate labels, disabled controls excluded, open shadow fields represented", () => {
  const w = page(
    '<label>Name<input></label><label>Name<input></label><input disabled><div id="host"></div>',
  );
  w.document.querySelector("#host").attachShadow({ mode: "open" }).innerHTML =
    "<label>City<input></label>";
  const s = capture(w);
  assert.equal(s.fields.length, 3);
  assert.equal(new Set(s.fields.map((f) => f.id)).size, 3);
  assert.match(s.html, /City/);
});
test("generated JavaScript sets values and dispatches events; independent verification catches false claims", async () => {
  const w = page(
    '<label>Name<input></label><input type="checkbox"><select><option value="">Choose</option><option value="it">Italy</option></select>',
  );
  const s = capture(w);
  let events = 0;
  w.document.querySelector("input").addEventListener("input", () => events++);
  const code = `af.set('${s.fields[0].id}','Davide'); af.set('${s.fields[1].id}',true); af.set('${s.fields[2].id}','it'); return {filled:[{id:'${s.fields[0].id}',value:'Davide'},{id:'${s.fields[1].id}',value:true},{id:'${s.fields[2].id}',value:'it'}],skipped:[]};`;
  const result = await w.eval(executeBody(code, s));
  assert.equal(events, 1);
  assert.equal(result.report.filled.length, 3);
  const verified = w.eval(
    `(${verifyReport.toString()})(${JSON.stringify(s)},${JSON.stringify(result.report)})`,
  );
  assert.equal(verified.verified, 3);
  assert.equal(verified.failed.length, 0);
  result.report.filled[0].value = "Wrong";
  const mismatch = w.eval(
    `(${verifyReport.toString()})(${JSON.stringify(s)},${JSON.stringify(result.report)})`,
  );
  assert.equal(mismatch.failed.length, 1);
});
test("stale or replaced fields prevent execution", async () => {
  const w = page("<input>");
  const s = capture(w);
  w.document.querySelector("input").remove();
  const result = await w.eval(executeBody("return {filled:[],skipped:[]}", s));
  assert.equal(result.ok, false);
  assert.match(result.error, /changed|changed|stale/i);
});
test("script failures are surfaced, not reported as successful fills", async () => {
  const w = page("<input>");
  const s = capture(w);
  const result = await w.eval(executeBody('throw new Error("broken")', s));
  assert.equal(result.ok, false);
});
test("an empty report cannot count as successful compilation", () => {
  const w = page("<input>");
  const s = capture(w);
  const v = w.eval(
    `(${verifyReport.toString()})(${JSON.stringify(s)}, {filled:[],skipped:[]})`,
  );
  assert.equal(v.verified, 0);
});
test("autocomplete tokens exclude card and one-time-code values regardless of case or spacing", () => {
  const w = page(
    '<input name="safe"><input autocomplete="section-checkout billing cc-number" value="CARDSECRET"><input autocomplete=" SHIPPING   CC-CSC " value="CSCSECRET"><input autocomplete="section-auth\tone-time-code" value="OTPSECRET">',
  );
  const s = capture(w);
  assert.equal(s.fields.length, 1);
  assert.doesNotMatch(s.html, /CARDSECRET|CSCSECRET|OTPSECRET/);
});
test("hidden shadow ancestors exclude their controls and private values", () => {
  const w = page(
    '<input name="safe"><div aria-hidden="true"><div id="host"></div></div>',
  );
  w.document.querySelector("#host").attachShadow({ mode: "open" }).innerHTML =
    '<input value="SHADOWSECRET">';
  const s = capture(w);
  assert.equal(s.fields.length, 1);
  assert.doesNotMatch(s.html, /SHADOWSECRET/);
});
test("nested display-none controls and shadow hosts do not enter field metadata", () => {
  const w = page(
    '<input name="safe"><div style="display:none"><input value="NESTEDSECRET"><div id="host"></div></div>',
  );
  w.document.querySelector("#host").attachShadow({ mode: "open" }).innerHTML =
    '<input value="SHADOWSECRET">';
  const s = capture(w);
  assert.equal(s.fields.length, 1);
  assert.doesNotMatch(s.html, /NESTEDSECRET|SHADOWSECRET/);
});
test("capture removes stale field markers from non-controls and excluded controls", () => {
  const w = page(
    '<div data-af-id="test-run-0">Decoy</div><input name="safe"><input disabled data-af-id="stale"><input type="password" data-af-id="old">',
  );
  const s = capture(w);
  const marked = w.document.querySelectorAll("[data-af-id]");
  assert.equal(marked.length, 1);
  assert.equal(marked[0].tagName, "INPUT");
  assert.equal(marked[0].getAttribute("data-af-id"), s.fields[0].id);
});
test("af.set rejects clearing a selected radio to avoid a false framework update", async () => {
  const w = page('<input type="radio" checked>');
  const s = capture(w);
  const el = w.document.querySelector("input");
  let inputs = 0,
    changes = 0;
  el.addEventListener("input", () => inputs++);
  el.addEventListener("change", () => changes++);
  const result = await w.eval(
    executeBody(
      `return {filled:[{id:'${s.fields[0].id}',value:af.set('${s.fields[0].id}',false)}],skipped:[]}`,
      s,
    ),
  );
  assert.equal(result.ok, false);
  assert.equal(el.checked, true);
  assert.match(result.error, /Select another option/);
  assert.equal(inputs, 0);
  assert.equal(changes, 0);
});
for (const type of ["checkbox", "radio"])
  test(`af.set ${type} click dispatches native events only once`, async () => {
    const w = page(`<input type="${type}">`);
    const s = capture(w);
    const el = w.document.querySelector("input");
    let inputs = 0,
      changes = 0;
    el.addEventListener("input", () => inputs++);
    el.addEventListener("change", () => changes++);
    const result = await w.eval(
      executeBody(
        `af.set('${s.fields[0].id}',true);return {filled:[],skipped:[]}`,
        s,
      ),
    );
    assert.equal(result.ok, true);
    assert.equal(el.checked, true);
    assert.equal(inputs, 1);
    assert.equal(changes, 1);
  });
test("capture rejects overlarge pages instead of truncating them", () => {
  const w = page("<input><div>" + "large".repeat(100) + "</div>");
  assert.throws(
    () => w.eval(`(${capturePage.toString()})('test-run',100)`),
    /too large/i,
  );
});
test("editing a populated field while generating prevents script execution", async () => {
  const w = page('<input value="Before">');
  const s = capture(w);
  w.document.querySelector("input").value = "User edit";
  const result = await w.eval(
    executeBody(`window.executed=true;return {filled:[],skipped:[]}`, s),
  );
  assert.equal(result.ok, false);
  assert.equal(w.executed, undefined);
  assert.equal(w.document.querySelector("input").value, "User edit");
});
test("invalid native values fail independent verification", async () => {
  const w = page('<input type="email">');
  const s = capture(w);
  const result = await w.eval(
    executeBody(
      `af.set('${s.fields[0].id}','invalid');return {filled:[{id:'${s.fields[0].id}',value:'invalid'}],skipped:[]}`,
      s,
    ),
  );
  const v = verify(w, s, result.report);
  assert.equal(v.verified, 0);
  assert.equal(v.failed.length, 1);
  assert.match(v.failed[0], /invalid/i);
});
test("capture and filling use current textarea values rather than default content", async () => {
  const w = page("<textarea>Default</textarea>");
  const el = w.document.querySelector("textarea");
  el.value = "Current";
  const s = capture(w);
  assert.equal(s.fields[0].value, "Current");
  assert.match(s.html, />Current<\/textarea>/);
  assert.doesNotMatch(s.html, /Default/);
  const result = await w.eval(
    executeBody(
      `af.set('${s.fields[0].id}','Updated');return {filled:[{id:'${s.fields[0].id}',value:'Updated'}],skipped:[]}`,
      s,
    ),
  );
  assert.equal(el.value, "Updated");
  assert.equal(verify(w, s, result.report).changed, 1);
});
test("duplicate reports and unknown ids cannot increase verified count", () => {
  const w = page('<input value="A">');
  const s = capture(w);
  const item = { id: s.fields[0].id, value: "A" };
  const v = verify(w, s, {
    filled: [item, item, { id: "unknown", value: "A" }],
    skipped: [],
  });
  assert.equal(v.verified, 1);
  assert.equal(v.changed, 0);
  assert.equal(v.failed.length, 2);
});
