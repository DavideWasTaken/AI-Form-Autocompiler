// Serialized into the user-script world. No extension messaging or API key is exposed.
export function runtimeHelpers() {
  const all = () => {
    const results = [];
    function visit(root) {
      results.push(...root.querySelectorAll("[data-af-id]"));
      for (const el of root.querySelectorAll("*"))
        if (el.shadowRoot) visit(el.shadowRoot);
    }
    visit(document);
    return results;
  };
  const get = (id) => all().find((el) => el.getAttribute("data-af-id") === id);
  const read = (el) => {
    if (el.matches('input[type="checkbox"],input[type="radio"]'))
      return el.checked;
    if (el.hasAttribute("aria-checked"))
      return el.getAttribute("aria-checked") === "true";
    if (el.matches("select[multiple]"))
      return [...el.selectedOptions].map((o) => o.value);
    return el.matches("input,textarea,select")
      ? el.value
      : el.textContent.trim();
  };
  const set = (id, value) => {
    const el = get(id);
    if (!el) throw new Error("Field no longer exists");
    if (el.disabled || el.readOnly) throw new Error("Field is not editable");
    if (el.matches('input[type="checkbox"],input[type="radio"]')) {
      const checked = Boolean(value);
      if (el.checked === checked) return read(el);
      if (el.matches('input[type="radio"]') && !checked) {
        throw new Error(
          "Clearing a selected radio is unsupported. Select another option in its group instead.",
        );
      } else {
        el.click(); // Native activation already emits input and change.
        return read(el);
      }
    } else if (el.hasAttribute("aria-checked")) {
      if ((el.getAttribute("aria-checked") === "true") !== Boolean(value))
        el.click();
    } else if (el.matches("select[multiple]")) {
      for (const option of el.options)
        option.selected = Array.isArray(value) && value.includes(option.value);
    } else if (el.matches("input,textarea,select")) {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : el instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, String(value));
      else el.value = String(value);
    } else if (
      el.isContentEditable ||
      el.getAttribute("contenteditable") === "true"
    )
      el.textContent = String(value);
    else throw new Error("Custom widget: use its DOM interactions");
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return read(el);
  };
  return { get, set, read, all };
}

export async function awaitExecution(promise, timeoutMs = 15000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            "Script execution did not finish. Refresh the page before trying again; the script may still be running.",
          );
          error.code = "EXECUTION_UNCERTAIN";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function executeBody(code, snapshot) {
  const before = JSON.stringify(
    snapshot.fields.map(({ id, value }) => ({ id, value })),
  );
  return `(async()=>{const af=(${runtimeHelpers.toString()})();try{
    const before=${before};
    for(const field of before){const el=af.get(field.id);if(!el||JSON.stringify(af.read(el))!==JSON.stringify(field.value))throw new Error('Page fields changed while generating. Analyze again.');}
    const report=await(async()=>{${code}\n})();
    return {ok:true,report};
  }catch(error){return {ok:false,error:String(error?.message||error).slice(0,300)};}})()`;
}

// Self-contained verifier runs in a separate, trusted content-script world.
export function verifyReport(snapshot, report) {
  if (
    !report ||
    !Array.isArray(report.filled) ||
    !Array.isArray(report.skipped)
  )
    throw new Error(
      "Script returned no usable completion report. Check the page before retrying.",
    );
  const elements = [];
  function visit(root) {
    elements.push(...root.querySelectorAll("[data-af-id]"));
    for (const el of root.querySelectorAll("*"))
      if (el.shadowRoot) visit(el.shadowRoot);
  }
  visit(document);
  const known = new Map(snapshot.fields.map((f) => [f.id, f]));
  const seen = new Set();
  const failed = [];
  const unchanged = [];
  let verified = 0;
  let changed = 0;
  for (const item of report.filled) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !known.has(item.id) ||
      seen.has(item.id)
    ) {
      failed.push("Invalid or duplicate field in script report");
      continue;
    }
    seen.add(item.id);
    const el = elements.find((e) => e.getAttribute("data-af-id") === item.id);
    const label = known.get(item.id).label || item.id;
    if (!el) {
      failed.push(`${label}: field disappeared`);
      continue;
    }
    let actual;
    if (el.matches('input[type="checkbox"],input[type="radio"]'))
      actual = el.checked;
    else if (el.hasAttribute("aria-checked"))
      actual = el.getAttribute("aria-checked") === "true";
    else if (el.matches("select[multiple]"))
      actual = [...el.selectedOptions].map((o) => o.value);
    else
      actual = el.matches("input,textarea,select")
        ? el.value
        : el.textContent.trim();
    const expected =
      typeof actual === "string" ? String(item.value) : item.value;
    if (
      JSON.stringify(actual) !== JSON.stringify(expected) ||
      (el.validity && !el.validity.valid)
    ) {
      failed.push(`${label}: value not acquired or invalid`);
      continue;
    }
    verified++;
    if (JSON.stringify(actual) !== JSON.stringify(known.get(item.id).value))
      changed++;
    else unchanged.push(label);
  }
  return {
    verified,
    changed,
    failed,
    unchanged,
    skipped: report.skipped
      .filter((s) => typeof s === "string")
      .map((s) => s.slice(0, 300)),
    total: snapshot.fields.length,
  };
}
