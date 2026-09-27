// Self-contained: Chrome serializes this function into an isolated content world.
export function capturePage(runId, maxChars = 100000) {
  const attr = "data-af-id";
  const fields = [];
  const selector =
    'input,textarea,select,[contenteditable="true"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[role="switch"],[role="listbox"]';
  const sensitive = (el) =>
    el.matches(
      'input[type="password"],input[type="hidden"],input[type="file"]',
    ) ||
    (el.getAttribute("autocomplete") || "")
      .toLowerCase()
      .split(/\s+/)
      .some((token) => token.startsWith("cc-") || token === "one-time-code");
  const hidden = (el) => {
    for (
      let ancestor = el;
      ancestor;
      ancestor = ancestor.parentElement || ancestor.getRootNode().host
    ) {
      if (
        ancestor.matches(
          '[hidden],[aria-hidden="true"],script,style,noscript,template',
        )
      )
        return true;
      const style = getComputedStyle(ancestor);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse"
      )
        return true;
    }
    return false;
  };
  function value(el) {
    if (el.matches('input[type="checkbox"],input[type="radio"]'))
      return el.checked;
    if (el.hasAttribute("aria-checked"))
      return el.getAttribute("aria-checked") === "true";
    if (el.matches("select[multiple]"))
      return [...el.selectedOptions].map((o) => o.value);
    if (el.matches("input,textarea,select")) return el.value;
    return el.textContent.trim();
  }
  function prepare(root) {
    // Remove stale or page-supplied markers even from elements we never capture.
    for (const el of root.querySelectorAll(`[${attr}]`))
      el.removeAttribute(attr);
    for (const el of root.querySelectorAll(selector)) {
      if (
        sensitive(el) ||
        hidden(el) ||
        el.disabled ||
        el.readOnly ||
        el.getAttribute("aria-disabled") === "true" ||
        !el.getClientRects().length ||
        el.matches(
          'input[type="submit"],input[type="reset"],input[type="button"],input[type="image"]',
        )
      )
        continue;
      const id = `${runId}-${fields.length}`;
      el.setAttribute(attr, id);
      const labelled = (el.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => root.getElementById(id)?.textContent || "")
        .join(" ")
        .trim();
      const label =
        el.getAttribute("aria-label") ||
        labelled ||
        [...(el.labels || [])].map((l) => l.textContent.trim()).join(" ") ||
        el.closest("label")?.textContent.trim() ||
        el.getAttribute("placeholder") ||
        el.getAttribute("name") ||
        "";
      fields.push({
        id,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") || el.getAttribute("role") || "",
        label: label.slice(0, 500),
        value: value(el),
      });
    }
    for (const el of root.querySelectorAll("*"))
      if (el.shadowRoot) prepare(el.shadowRoot);
  }
  prepare(document);
  function clone(node) {
    if (node.nodeType === Node.TEXT_NODE)
      return document.createTextNode(node.textContent);
    if (
      node.nodeType !== Node.ELEMENT_NODE ||
      node.matches(
        "script,style,noscript,template,svg,canvas,iframe,object,embed,link,meta",
      ) ||
      hidden(node) ||
      sensitive(node)
    )
      return null;
    const out = document.createElement(
      node.tagName.toLowerCase().includes("-")
        ? "div"
        : node.tagName.toLowerCase(),
    );
    const allowed = new Set([
      "id",
      "class",
      "name",
      "type",
      "role",
      "placeholder",
      "for",
      "title",
      "required",
      "disabled",
      "readonly",
      "multiple",
      "min",
      "max",
      "step",
      "pattern",
      "maxlength",
      attr,
    ]);
    for (const a of node.attributes)
      if (allowed.has(a.name) || a.name.startsWith("aria-"))
        out.setAttribute(a.name, a.value);
    if (node.matches("option")) {
      out.setAttribute("value", node.value);
      if (node.selected) out.setAttribute("selected", "");
    }
    if (node.matches("input")) {
      out.setAttribute("value", node.value);
      if (node.checked) out.setAttribute("checked", "");
    }
    if (node.matches("textarea")) out.textContent = node.value;
    else
      for (const child of node.childNodes) {
        const copy = clone(child);
        if (copy) out.append(copy);
      }
    if (node.shadowRoot) {
      const boundary = document.createElement("section");
      boundary.setAttribute("data-open-shadow-root", "");
      for (const child of node.shadowRoot.childNodes) {
        const copy = clone(child);
        if (copy) boundary.append(copy);
      }
      out.append(boundary);
    }
    return out;
  }
  const html = clone(document.body)?.outerHTML || "";
  if (html.length > maxChars)
    throw new Error(
      `Page too large (${html.length} characters). Open a simpler page or form section.`,
    );
  if (fields.length === 0)
    throw new Error(
      "No editable fields found in the main page. Embedded frames are not supported yet.",
    );
  return {
    html,
    fields,
    title: document.title.slice(0, 300),
    url: location.origin + location.pathname,
    runId,
    frameCount: document.querySelectorAll("iframe").length,
  };
}
