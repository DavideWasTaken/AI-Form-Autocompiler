// Self-contained: inject only into the extension's ISOLATED world, never MAIN.
export function manageRecovery(action, payload = {}) {
  const key = "__afDocumentRecoveryV1";
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const empty = () => ({ canUndo: false, changed: 0, unsupported: 0, fields: [] });
  let state = globalThis[key];
  const native = (el, property, value, write = false) => {
    const prototype = el instanceof HTMLInputElement ? HTMLInputElement.prototype
      : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : el instanceof HTMLOptionElement ? HTMLOptionElement.prototype : Node.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    return write ? descriptor.set.call(el, value) : descriptor.get.call(el);
  };
  const plain = (el) => [...el.childNodes].every((node) => node.nodeType === Node.TEXT_NODE);
  const kind = (el) => {
    if (el.matches('input[type="radio"],input[type="password"],input[type="file"],input[type="hidden"],input[type="button"],input[type="submit"],input[type="reset"],input[type="image"]')) return "unsupported";
    if (el.matches('input[type="checkbox"]')) return "checkbox";
    if (el.matches("input,textarea")) return "text";
    if (el.matches("select")) return "select";
    if (el.getAttribute("contenteditable") === "true" && plain(el)) return "editable";
    return "unsupported";
  };
  const visibleValue = (el) => {
    if (el.matches('input[type="checkbox"],input[type="radio"]')) return native(el, "checked");
    if (el.hasAttribute("aria-checked")) return el.getAttribute("aria-checked") === "true";
    if (el.matches("select[multiple]")) return [...el.selectedOptions].map((option) => option.value);
    if (el.matches("input,textarea,select")) return native(el, "value");
    return el.textContent.trim();
  };
  const read = (entry) => {
    const el = entry.node;
    if (entry.kind === "checkbox") return [native(el, "checked"), native(el, "indeterminate")];
    if (entry.kind === "text") return native(el, "value");
    if (entry.kind === "select") return [...el.options].map((option) => native(option, "selected"));
    if (entry.kind === "editable") return el.textContent;
    return [visibleValue(el), el.innerHTML];
  };
  const intact = (entry) => {
    const el = entry.node;
    if (kind(el) !== entry.kind || el.getAttribute("type") !== entry.type || el.disabled || el.readOnly || el.getAttribute("aria-disabled") === "true") return false;
    if (entry.kind === "select") return el.multiple === entry.multiple && entry.options.length === el.options.length && entry.options.every((option, index) => option === el.options[index] && option.value === entry.optionValues[index]);
    return true;
  };
  const unhighlight = () => {
    if (!state) return;
    for (const entry of state.entries) entry.node.removeAttribute(state.marker);
    for (const style of state.styles) style.remove();
    state.styles = [];
  };
  const highlight = () => {
    unhighlight();
    if (!state || state.highlightsCleared) return;
    const colors = { verified: "#16803d", changed: "#2563eb", failed: "#dc2626", skipped: "#64748b", conflict: "#d97706" };
    const roots = new Set();
    for (const entry of state.entries) {
      if (!entry.node.isConnected || !colors[entry.status]) continue;
      entry.node.setAttribute(state.marker, entry.status);
      roots.add(entry.node.getRootNode());
    }
    for (const root of roots) {
      const style = document.createElement("style");
      style.textContent = Object.entries(colors).map(([status, color]) => `[${state.marker}="${status}"]{outline:2px solid ${color}!important;outline-offset:3px!important}`).join("\n");
      (root === document ? document.head || document.documentElement : root).append(style);
      state.styles.push(style);
    }
  };
  const summary = () => state ? {
    canUndo: state.finished && state.entries.some((entry) => entry.changed && entry.kind !== "unsupported" && !entry.resolved && entry.node.isConnected),
    changed: state.entries.filter((entry) => entry.changed).length,
    unsupported: state.entries.filter((entry) => entry.changed && entry.kind === "unsupported").length,
    ...(state.undone ? { restored: state.entries.filter((entry) => entry.status === "restored").length, conflicts: state.entries.filter((entry) => entry.status === "conflict").length } : {}),
    fields: state.entries.map((entry) => ({ id: entry.node.getAttribute("data-af-id") || entry.id, label: entry.label, status: entry.status, undoSupported: entry.kind !== "unsupported" })),
  } : empty();

  if (action === "status") return summary();
  if (action === "clear") {
    unhighlight();
    if (state) state.highlightsCleared = true;
    return summary();
  }
  if (action === "discard") {
    unhighlight();
    delete globalThis[key];
    return empty();
  }
  if (action === "begin") {
    if (!Array.isArray(payload.snapshot?.fields) || !payload.snapshot.fields.length) throw new Error("No editable fields to recover.");
    const nodes = [];
    function visit(root) {
      nodes.push(...root.querySelectorAll("[data-af-id]"));
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) visit(el.shadowRoot);
    }
    visit(document);
    const entries = payload.snapshot.fields.map((field) => {
      const matches = nodes.filter((el) => el.getAttribute("data-af-id") === field.id);
      const node = matches[0];
      if (matches.length !== 1 || !node.isConnected || node.disabled || node.readOnly || !same(visibleValue(node), field.value)) throw new Error("Page fields changed while generating. Analyze again.");
      const entry = { node, id: field.id, label: String(field.label || field.id).slice(0, 500), kind: kind(node), type: node.getAttribute("type"), status: "pending", changed: false, resolved: false };
      if (entry.kind === "select") {
        entry.options = [...node.options];
        entry.optionValues = entry.options.map((option) => option.value);
        entry.multiple = node.multiple;
      }
      entry.before = read(entry);
      return entry;
    });
    unhighlight();
    state = { entries, styles: [], marker: `data-af-recovery-${crypto.randomUUID()}`, finished: false, undone: false, highlightsCleared: false };
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: state });
    return summary();
  }
  if (!state) return empty();
  if (action === "finish") {
    // A second finish must never absorb edits made after the first checkpoint.
    if (state.finished) return summary();
    const report = payload.report;
    const reported = Array.isArray(report?.filled) ? report.filled : [];
    for (const entry of state.entries) {
      if (!entry.node.isConnected) { entry.status = "removed"; entry.resolved = true; continue; }
      entry.after = read(entry);
      entry.changed = !same(entry.before, entry.after);
      if (!intact(entry)) { entry.status = "failed"; continue; }
      const claimed = reported.filter((item) => item?.id === entry.id);
      if (claimed.length) {
        const value = visibleValue(entry.node);
        const expected = typeof value === "string" ? String(claimed[0].value) : claimed[0].value;
        entry.status = claimed.length === 1 && same(value, expected) && (!entry.node.validity || entry.node.validity.valid) ? "verified" : "failed";
      } else entry.status = entry.changed ? report ? "failed" : "changed" : "skipped";
    }
    state.finished = true;
    highlight();
    return summary();
  }
  if (action === "undo") {
    if (!state.finished || state.undone) return summary();
    for (const entry of state.entries) {
      if (!entry.changed || entry.kind === "unsupported" || entry.resolved) continue;
      entry.resolved = true;
      if (!entry.node.isConnected) { entry.status = "removed"; continue; }
      if (!intact(entry) || !same(read(entry), entry.after)) { entry.status = "conflict"; continue; }
      const el = entry.node;
      try {
        let activated = false;
        if (entry.kind === "checkbox") {
          if (native(el, "checked") !== entry.before[0]) {
            // React observes checkable inputs through click. Native activation
            // also emits input/change, so never dispatch duplicate events here.
            HTMLElement.prototype.click.call(el);
            activated = true;
          }
          native(el, "indeterminate", entry.before[1], true);
        } else if (entry.kind === "text") native(el, "value", entry.before, true);
        else if (entry.kind === "select") {
          native(el, "selectedIndex", -1, true);
          entry.options.forEach((option, index) => native(option, "selected", entry.before[index], true));
        } else native(el, "textContent", entry.before, true);
        if (!activated) {
          el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
          el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        }
        entry.status = intact(entry) && same(read(entry), entry.before) ? "restored" : "conflict";
      } catch { entry.status = "conflict"; }
    }
    // A later field's handler may synchronously change an earlier field.
    for (const entry of state.entries) {
      if (entry.status !== "restored") continue;
      if (!entry.node.isConnected) entry.status = "removed";
      else if (!intact(entry) || !same(read(entry), entry.before)) entry.status = "conflict";
    }
    state.undone = true;
    highlight();
    return summary();
  }
  throw new Error("Unknown recovery action.");
}
