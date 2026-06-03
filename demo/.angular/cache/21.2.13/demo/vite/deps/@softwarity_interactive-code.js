import "./chunk-46DXP6YY.js";

// node_modules/@softwarity/interactive-code/dist/interactive-code.js
var n = class extends HTMLElement {
  constructor() {
    super(...arguments), this._disabled = false, this._connected = false;
  }
  get key() {
    return this.getAttribute("key") || "";
  }
  get type() {
    return this.getAttribute("type") || "readonly";
  }
  get min() {
    const n2 = this.getAttribute("min");
    return null !== n2 ? Number(n2) : void 0;
  }
  get max() {
    const n2 = this.getAttribute("max");
    return null !== n2 ? Number(n2) : void 0;
  }
  get step() {
    const n2 = this.getAttribute("step");
    return null !== n2 ? Number(n2) : void 0;
  }
  get options() {
    const n2 = this.getAttribute("options");
    return n2 ? n2.split(",").map((n3) => n3.trim()) : [];
  }
  get carousel() {
    return this.hasAttribute("carousel");
  }
  get value() {
    return this._value;
  }
  set value(n2) {
    const e2 = this._value;
    this._value = this.parseValue(n2), e2 !== this._value && this.emitChange();
  }
  get disabled() {
    return this._disabled;
  }
  set disabled(n2) {
    this._disabled = true === n2 || "true" === n2;
  }
  connectedCallback() {
    const n2 = this.getAttribute("value");
    null !== n2 && (this._value = this.parseValue(n2)), this._disabled = this.hasAttribute("disabled"), this._connected = true;
  }
  attributeChangedCallback(n2, e2, t2) {
    if ("value" === n2 && null !== t2) {
      const n3 = this.parseValue(t2);
      this._value !== n3 && (this._value = n3, this._connected && this.emitChange());
    } else "disabled" === n2 && (this._disabled = null !== t2);
  }
  parseValue(n2) {
    if (null != n2) switch (this.type) {
      case "boolean":
      case "comment":
      case "attribute":
        return "true" === n2 || true === n2;
      case "number":
        return "number" == typeof n2 ? n2 : Number(n2);
      default:
        return String(n2);
    }
  }
  emitChange() {
    const n2 = new CustomEvent("change", { detail: this._value, bubbles: true, composed: true }), e2 = this.getAttribute("onchange");
    e2 && new Function("e", e2).call(this, n2), this.dispatchEvent(n2);
  }
  toggle() {
    if (!this._disabled) {
      if ("boolean" === this.type || "comment" === this.type || "attribute" === this.type) this.value = !this._value;
      else if ("select" === this.type) {
        const n2 = this.options;
        if (n2.length > 0) {
          const e2 = (n2.indexOf(this._value) + 1) % n2.length;
          this.value = n2[e2];
        }
      }
    }
  }
  previous() {
    if (!this._disabled && "select" === this.type) {
      const n2 = this.options;
      if (n2.length > 0) {
        const e2 = (n2.indexOf(this._value) - 1 + n2.length) % n2.length;
        this.value = n2[e2];
      }
    }
  }
  increment() {
    if (!this._disabled && "number" === this.type) {
      const n2 = this.step ?? 1, e2 = this.max;
      let t2 = (this._value || 0) + n2;
      void 0 !== e2 && t2 > e2 && (t2 = e2), this.value = t2;
    }
  }
  decrement() {
    if (!this._disabled && "number" === this.type) {
      const n2 = this.step ?? 1, e2 = this.min;
      let t2 = (this._value || 0) - n2;
      void 0 !== e2 && t2 < e2 && (t2 = e2), this.value = t2;
    }
  }
};
n.observedAttributes = ["value", "disabled"];
var e = n;
var t = class extends HTMLElement {
  constructor() {
    super(), this.templateContent = "", this.conditionalContents = [], this.bindings = /* @__PURE__ */ new Map(), this._code = null, this._initialized = false, this._internalChange = false, this._observer = null, this._fallbackTimeout = null, this._copyTimeout = null, this.shadow = this.attachShadow({ mode: "open" }), this._boundChangeHandler = this._handleChange.bind(this), this._boundShadowMousedownHandler = this._handleShadowMousedown.bind(this), this._boundShadowClickHandler = this._handleShadowClick.bind(this), this._boundShadowChangeHandler = this._handleShadowChange.bind(this), this._boundShadowInputHandler = this._handleShadowInput.bind(this), this._boundShadowKeydownHandler = this._handleShadowKeydown.bind(this);
  }
  get language() {
    return this.getAttribute("language") || "html";
  }
  get showSeparators() {
    return this.hasAttribute("show-separators");
  }
  get showLineNumbers() {
    return this.hasAttribute("show-line-numbers");
  }
  get showCopy() {
    return this.hasAttribute("show-copy");
  }
  get colorScheme() {
    return this.getAttribute("color-scheme") || "";
  }
  get code() {
    return this._code;
  }
  set code(n2) {
    this._code = n2, null !== n2 && (this.templateContent = n2, this._initialized && this.updateCode());
  }
  connectedCallback() {
    this.render(), this.setupEventListeners(), this.extractTemplate(), this.collectBindings(), this.templateContent ? (this.updateCode(), this._initialized = true) : (this._observer = new MutationObserver(() => {
      this.extractTemplate(), this.collectBindings(), this.templateContent && (this._observer?.disconnect(), this._observer = null, this.updateCode(), this._initialized = true);
    }), this._observer.observe(this, { childList: true, subtree: true }), this._fallbackTimeout = setTimeout(() => {
      this._observer?.disconnect(), this._observer = null, this._fallbackTimeout = null, this.extractTemplate(), this.collectBindings(), this.updateCode(), this._initialized = true;
    }, 100));
  }
  disconnectedCallback() {
    this._observer && (this._observer.disconnect(), this._observer = null), this._fallbackTimeout && (clearTimeout(this._fallbackTimeout), this._fallbackTimeout = null), this._copyTimeout && (clearTimeout(this._copyTimeout), this._copyTimeout = null), this.removeEventListener("change", this._boundChangeHandler), this.shadow.removeEventListener("mousedown", this._boundShadowMousedownHandler), this.shadow.removeEventListener("click", this._boundShadowClickHandler), this.shadow.removeEventListener("change", this._boundShadowChangeHandler), this.shadow.removeEventListener("input", this._boundShadowInputHandler), this.shadow.removeEventListener("keydown", this._boundShadowKeydownHandler);
  }
  attributeChangedCallback(n2, e2, t2) {
    if (e2 !== t2 && this._initialized) {
      if ("color-scheme" === n2) return;
      this.updateCode();
    }
  }
  render() {
    this.shadow.innerHTML = `
      <style>${this.getStyles()}</style>
      <pre class="code-block"><button class="copy-button" aria-label="Copy code to clipboard" tabindex="0"><svg class="copy-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><svg class="check-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button><code></code></pre>
    `, this.codeContainer = this.shadow.querySelector("code");
  }
  extractTemplate() {
    if (null !== this._code) return;
    const n2 = this.querySelectorAll("textarea");
    if (n2.length > 0) return this.conditionalContents = [], n2.forEach((n3) => {
      n3.style.display = "none";
      const e3 = n3.value.replace(/^\n/, "").replace(/\n\s*$/, "") || "", t2 = n3.getAttribute("condition");
      this.conditionalContents.push({ content: e3, condition: t2 });
    }), void this.updateTemplateContent();
    const e2 = this.querySelector("template");
    e2 && (this.templateContent = e2.innerHTML.replace(/^\n/, "").replace(/\n\s*$/, ""), this.conditionalContents = [{ content: this.templateContent, condition: null }]);
  }
  updateTemplateContent() {
    const n2 = [];
    for (const { content: e2, condition: t2 } of this.conditionalContents) this.evaluateCondition(t2) && n2.push(e2);
    this.showSeparators && n2.length > 1 ? this.templateContent = n2.join("\n__SECTION_SEPARATOR__\n") : this.templateContent = n2.join("\n");
  }
  evaluateCondition(n2) {
    if (null === n2 || "" === n2) return true;
    const e2 = n2.startsWith("!"), t2 = e2 ? n2.slice(1).trim() : n2.trim(), i2 = t2.indexOf("=");
    if (-1 !== i2) {
      const n3 = t2.slice(0, i2).trim(), a3 = t2.slice(i2 + 1).trim(), s2 = this.bindings.get(n3);
      if (!s2) return e2;
      const o2 = String(s2.value) === a3;
      return e2 ? !o2 : o2;
    }
    const a2 = t2, s = this.bindings.get(a2);
    if (!s) return e2;
    const o = s.value, r = null != o && false !== o && "undefined" !== o;
    return e2 ? !r : r;
  }
  collectBindings() {
    this.querySelectorAll("code-binding").forEach((n2) => {
      n2.key && this.bindings.set(n2.key, n2);
    });
  }
  hasConditionDependency(n2) {
    return this.conditionalContents.some((e2) => {
      if (!e2.condition) return false;
      const t2 = e2.condition.startsWith("!") ? e2.condition.slice(1).trim() : e2.condition.trim(), i2 = t2.indexOf("=");
      return (-1 !== i2 ? t2.slice(0, i2).trim() : t2) === n2;
    });
  }
  setupEventListeners() {
    this.addEventListener("change", this._boundChangeHandler), this.shadow.addEventListener("mousedown", this._boundShadowMousedownHandler), this.shadow.addEventListener("click", this._boundShadowClickHandler), this.shadow.addEventListener("change", this._boundShadowChangeHandler), this.shadow.addEventListener("input", this._boundShadowInputHandler), this.shadow.addEventListener("keydown", this._boundShadowKeydownHandler);
  }
  _handleChange(n2) {
    "CODE-BINDING" !== n2.target.tagName || this._internalChange || this.updateCode();
  }
  _handleShadowMousedown(n2) {
    const e2 = n2;
    e2.shiftKey && e2.target.closest(".inline-select-carousel") && n2.preventDefault();
  }
  _handleShadowClick(n2) {
    const e2 = n2.target;
    if (e2.closest(".copy-button")) return void this.copyToClipboard();
    if ("INPUT" === e2.tagName || "SELECT" === e2.tagName) return;
    const t2 = e2.closest("[data-binding]");
    if (!t2) return;
    const i2 = t2.dataset.binding, a2 = t2.dataset.action;
    if (!i2) return;
    const s = this.bindings.get(i2);
    if (!s) return;
    const o = n2.shiftKey || false;
    this.handleAction(s, a2, o);
  }
  _handleShadowChange(n2) {
    const e2 = n2.target;
    if (e2.classList.contains("inline-select-input")) {
      const n3 = e2.dataset.binding;
      if (n3) {
        const t2 = this.bindings.get(n3);
        if (t2) {
          const i2 = e2.value, a2 = e2.parentElement?.querySelector(".token-string");
          a2 && (a2.textContent = i2), this._internalChange = true;
          try {
            t2.value = i2;
          } finally {
            this._internalChange = false;
          }
          this.hasConditionDependency(n3) && this.updateCode();
        }
      }
    }
  }
  _handleShadowInput(n2) {
    const e2 = n2.target;
    e2.classList.contains("inline-number-input") ? (n2.stopPropagation(), this._handleInlineNumberInput(e2)) : e2.classList.contains("inline-string-input") ? (n2.stopPropagation(), this._handleInlineStringInput(e2)) : "color" === e2.type && (n2.stopPropagation(), this._handleInlineColorInput(e2));
  }
  _handleInlineNumberInput(n2) {
    const e2 = n2.dataset.binding;
    if (!e2) return;
    const t2 = this.bindings.get(e2);
    if (!t2) return;
    const i2 = n2.valueAsNumber || 0, a2 = n2.parentElement?.querySelector(".token-number");
    a2 && (a2.textContent = String(i2)), this._internalChange = true;
    try {
      t2.value = i2;
    } finally {
      this._internalChange = false;
    }
    this.hasConditionDependency(e2) && this.updateCode();
  }
  _handleInlineStringInput(n2) {
    const e2 = n2.dataset.binding;
    if (!e2) return;
    const t2 = this.bindings.get(e2);
    if (!t2) return;
    const i2 = n2.value, a2 = n2.parentElement?.querySelector(".token-string");
    a2 && (a2.textContent = i2), this._internalChange = true;
    try {
      t2.value = i2;
    } finally {
      this._internalChange = false;
    }
    this.hasConditionDependency(e2) && this.updateCode();
  }
  _handleInlineColorInput(n2) {
    const e2 = n2.dataset.binding;
    if (!e2) return;
    const t2 = this.bindings.get(e2);
    if (!t2) return;
    const i2 = n2.value, a2 = n2.parentElement?.querySelector(".color-preview"), s = n2.parentElement?.querySelector(".token-string");
    a2 && (a2.style.background = i2), s && (s.textContent = i2), this._internalChange = true;
    try {
      t2.value = i2;
    } finally {
      this._internalChange = false;
    }
    this.hasConditionDependency(e2) && this.updateCode();
  }
  _handleShadowKeydown(n2) {
    const e2 = n2, t2 = e2.target;
    if (t2.classList.contains("copy-button") && ("Enter" === e2.key || " " === e2.key)) return e2.preventDefault(), void this.copyToClipboard();
    const i2 = t2.closest("[data-binding]");
    if (!i2) return;
    const a2 = i2.dataset.binding;
    if (!a2) return;
    const s = this.bindings.get(a2);
    if (s) if ("Enter" === e2.key || " " === e2.key) {
      e2.preventDefault();
      const n3 = i2.dataset.action;
      this.handleAction(s, n3);
    } else "ArrowUp" === e2.key && "number" === s.type ? (e2.preventDefault(), s.increment()) : "ArrowDown" === e2.key && "number" === s.type ? (e2.preventDefault(), s.decrement()) : "ArrowUp" === e2.key && "select" === s.type && s.carousel ? (e2.preventDefault(), s.toggle()) : "ArrowDown" === e2.key && "select" === s.type && s.carousel && (e2.preventDefault(), s.previous());
  }
  handleAction(n2, e2, t2 = false) {
    switch (e2) {
      case "toggle":
        t2 && n2.carousel ? n2.previous() : n2.toggle();
        break;
      case "edit-number":
        const e3 = this.shadow.querySelector(`#num-${n2.key}`);
        e3 && (e3.focus(), e3.select());
        break;
      case "edit-string":
        const i2 = this.shadow.querySelector(`#str-${n2.key}`);
        i2 && (i2.focus(), i2.select());
        break;
      case "edit-color":
        const a2 = this.shadow.querySelector(`#color-${n2.key}`);
        a2 && a2.click();
        break;
      case "edit-select":
        const s = this.shadow.querySelector(`#sel-${n2.key}`);
        s && s.focus();
    }
  }
  updateCode() {
    this.conditionalContents.length > 0 && this.updateTemplateContent();
    const n2 = this.renderTemplate();
    this.codeContainer.innerHTML = n2;
  }
  getCommentStyle(n2) {
    switch (n2) {
      case "html":
        return { line: "&lt;!-- ", lineIndicator: "&lt;!--", blockStart: "&lt;!-- ", blockIndicator: "&lt;!--", blockEnd: " --&gt;", blockEndIndicator: "--&gt;" };
      case "shell":
        return { line: "# ", lineIndicator: "#", blockStart: "# ", blockIndicator: "#", blockEnd: "", blockEndIndicator: "" };
      default:
        return { line: "// ", lineIndicator: "//", blockStart: "/* ", blockIndicator: "/*", blockEnd: " */", blockEndIndicator: "*/" };
    }
  }
  findBlockCommentKeys() {
    const n2 = /* @__PURE__ */ new Set(), e2 = /\$\{\/([\w-]+)\}/g;
    let t2;
    for (; null !== (t2 = e2.exec(this.templateContent)); ) n2.add(t2[1]);
    return n2;
  }
  isOpeningStyleTag(n2) {
    return /<style[\s>]/i.test(n2);
  }
  isClosingStyleTag(n2) {
    return /<\/style>/i.test(n2);
  }
  isOpeningScriptTag(n2) {
    return /<script[\s>]/i.test(n2);
  }
  isClosingScriptTag(n2) {
    return /<\/script>/i.test(n2);
  }
  renderTemplate() {
    const n2 = this.templateContent.split("\n"), e2 = this.getCommentStyle(this.language), t2 = this.findBlockCommentKeys(), i2 = /* @__PURE__ */ new Set(), a2 = [];
    let s = 1, o = this.language;
    for (const r of n2) {
      if ("__SECTION_SEPARATOR__" === r) {
        a2.push('<span class="section-separator"></span>');
        continue;
      }
      let n3 = o;
      if ("html" === this.language) {
        const e3 = r.replace(/\$\{[\w-]+\}/g, "").replace(/\$\{\/[\w-]+\}/g, "").trim();
        ("scss" === o && this.isClosingStyleTag(e3) || "typescript" === o && this.isClosingScriptTag(e3)) && (n3 = "html", o = "html"), "html" === o && (this.isOpeningStyleTag(e3) && !this.isClosingStyleTag(e3) ? (n3 = "html", o = "scss") : this.isOpeningScriptTag(e3) && !this.isClosingScriptTag(e3) && (n3 = "html", o = "typescript"));
      }
      a2.push(this.renderLine(r, e2, t2, i2, this.showLineNumbers ? s : 0, n3)), s++;
    }
    return a2.join("");
  }
  renderLine(n2, e2, t2, i2, a2, s) {
    const o = n2.match(/^(\s*)/), r = o ? o[1] : "";
    let l, c = n2.slice(r.length);
    const d = c.match(/^\$\{([\w-]+)\}/);
    if (d) {
      const n3 = this.bindings.get(d[1]);
      "comment" !== n3?.type || t2.has(d[1]) || (l = n3, c = c.slice(d[0].length));
    }
    const p = Array.from(i2).some((n3) => {
      const e3 = this.bindings.get(n3);
      return false === e3?.value;
    }), { processedContent: h, blockStartsOnLine: u, blockEndsOnLine: g } = this.processMarkers(c, e2, t2, i2, s), b = u.some((n3) => false === this.bindings.get(n3)?.value), k = g.some((n3) => false === this.bindings.get(n3)?.value), m = p || b || k;
    return this.buildLineHtml(r, h, l, m, e2, a2);
  }
  processMarkers(n2, e2, t2, i2, a2) {
    let s = 0;
    const o = /* @__PURE__ */ new Map(), r = [], l = [];
    let c = n2.replace(/\$\{([\w-]+)\}(="[^"]*")?/g, (n3, a3, l2) => {
      const c2 = this.bindings.get(a3);
      if ("comment" === c2?.type && t2.has(a3)) {
        r.push(a3), i2.add(a3);
        const n4 = `__COMMENT_START_${s++}__`, t3 = true === c2.value, l3 = `<span class="block-toggle inline-control ${t3 ? "block-toggle-inactive" : "block-toggle-active"}" part="interactive" data-binding="${a3}" data-action="toggle" role="button" tabindex="0" aria-label="Toggle block comment ${a3}">${e2.blockIndicator}</span>`;
        return t3 ? o.set(n4, l3) : o.set(n4, l3 + " "), n4;
      }
      const d = `__BINDING_${s++}__`;
      return c2 ? o.set(d, this.renderBinding(c2, l2)) : o.set(d, `<span class="token-unknown">\${${a3}}</span>`), d;
    });
    c = c.replace(/\$\{\/([\w-]+)\}/g, (n3, t3) => {
      const a3 = this.bindings.get(t3);
      if ("comment" === a3?.type && e2.blockEndIndicator) {
        l.push(t3), i2.delete(t3);
        const n4 = `__COMMENT_END_${s++}__`, r3 = true === a3.value, c2 = `<span class="block-end ${r3 ? "block-toggle-inactive" : "block-toggle-active"}">${e2.blockEndIndicator}</span>`;
        return o.set(n4, (r3 ? "" : " ") + c2), n4;
      }
      const r2 = `__BINDING_${s++}__`;
      return o.set(r2, `<span class="token-unknown">\${/${t3}}</span>`), r2;
    }), c = this.highlightSyntax(c, a2);
    for (const [d, p] of o) c = c.replace(d, p);
    return { processedContent: c, blockStartsOnLine: r, blockEndsOnLine: l };
  }
  buildLineHtml(n2, e2, t2, i2, a2, s) {
    const o = s > 0 ? `<span class="line-number">${s}</span>` : "";
    if (t2) {
      const i3 = true === t2.value;
      return `<span class="code-line${i3 ? "" : " line-disabled"}">${o}<span class="indent">${n2}</span><span class="line-toggle inline-control ${i3 ? "line-toggle-inactive" : "line-toggle-active"}" part="interactive" data-binding="${t2.key}" data-action="toggle" role="button" tabindex="0" aria-label="Toggle line comment ${t2.key}">${a2.lineIndicator}</span>${e2}${"html" !== this.language || i3 ? "" : `<span class="token-comment">${a2.blockEnd}</span>`}</span>`;
    }
    return i2 ? `<span class="code-line line-disabled">${o}<span class="indent">${n2}</span>${e2}</span>` : `<span class="code-line">${o}<span class="indent">${n2}</span>${e2}</span>`;
  }
  renderBinding(n2, e2) {
    const t2 = n2.value, i2 = n2.key, a2 = n2.disabled ? " disabled" : "", s = n2.disabled ? "-1" : "0", o = this.escapeHtml(String(t2 ?? "")), r = this.escapeHtml(i2);
    switch (n2.type) {
      case "boolean":
        return `<span class="inline-control inline-boolean${a2}" part="interactive" data-binding="${r}" data-action="toggle" role="button" tabindex="${s}" aria-label="Toggle ${r}: ${o}"><span class="token-keyword">${o}</span></span>`;
      case "number":
        return `<span class="inline-control inline-number${a2}" part="interactive" data-binding="${r}" data-action="edit-number" role="spinbutton" tabindex="${s}" aria-label="Edit ${r}" aria-valuenow="${o}"${void 0 !== n2.min ? ` aria-valuemin="${n2.min}"` : ""}${void 0 !== n2.max ? ` aria-valuemax="${n2.max}"` : ""}><span class="token-number">${o}</span><input type="number" class="inline-number-input" id="num-${r}" data-binding="${r}" value="${o}" ${void 0 !== n2.min ? `min="${n2.min}"` : ""} ${void 0 !== n2.max ? `max="${n2.max}"` : ""} ${void 0 !== n2.step ? `step="${n2.step}"` : ""}></span>`;
      case "string":
        return `<span class="inline-control inline-string${a2}" part="interactive" data-binding="${r}" data-action="edit-string" role="textbox" tabindex="${s}" aria-label="Edit ${r}"><span class="token-string">${o}</span><input type="text" class="inline-string-input" id="str-${r}" data-binding="${r}" value="${o}"></span>`;
      case "select": {
        const e3 = n2.options;
        return n2.carousel ? `<span class="inline-control inline-select-carousel${a2}" part="interactive" data-binding="${r}" data-action="toggle" role="button" tabindex="${s}" aria-label="Cycle ${r}: ${o}"><span class="token-string">${o}</span></span>` : 2 === e3.length ? `<span class="inline-control inline-select-toggle${a2}" part="interactive" data-binding="${r}" data-action="toggle" role="button" tabindex="${s}" aria-label="Toggle ${r}: ${o}"><span class="token-string">${o}</span></span>` : `<span class="inline-control inline-select-wrapper${a2}" part="interactive" data-binding="${r}" data-action="edit-select" role="listbox" tabindex="${s}" aria-label="Select ${r}"><span class="token-string">${o}</span><select class="inline-select-input" id="sel-${r}" data-binding="${r}">${e3.map((n3) => {
          const e4 = this.escapeHtml(n3);
          return `<option value="${e4}"${n3 === t2 ? " selected" : ""}>${e4}</option>`;
        }).join("")}</select></span>`;
      }
      case "color": {
        const n3 = this.escapeHtml(String(t2 || "#000000"));
        return `<span class="inline-control inline-color${a2}" part="interactive" data-binding="${r}" data-action="edit-color" role="button" tabindex="${s}" aria-label="Pick color ${r}: ${o}"><span class="color-preview" style="background:${n3}"></span><span class="token-string">${o}</span><input type="color" id="color-${r}" data-binding="${r}" value="${n3}"></span>`;
      }
      case "attribute":
        return `<span class="inline-control inline-attribute${a2}${true === t2 ? "" : " attribute-disabled"}" part="interactive" data-binding="${r}" data-action="toggle" role="button" tabindex="${s}" aria-label="Toggle attribute ${r}">${e2 ? `<span class="token-attr-name">${r}</span><span class="token-punctuation">=</span><span class="token-attr-value">${this.escapeHtml(e2.slice(1))}</span>` : `<span class="token-attr-name">${r}</span>`}</span>`;
      case "readonly":
        return `<span class="token-value">${o}</span>`;
      default:
        return `${o}`;
    }
  }
  getPlainText() {
    const n2 = [], e2 = this.codeContainer.children;
    for (let t2 = 0; t2 < e2.length; t2++) {
      const i2 = e2[t2];
      if (i2.classList.contains("section-separator")) continue;
      const a2 = i2.cloneNode(true);
      a2.querySelectorAll(".line-number").forEach((n3) => n3.remove()), n2.push(a2.textContent || "");
    }
    return n2.join("\n");
  }
  copyToClipboard() {
    const n2 = this.getPlainText();
    navigator.clipboard.writeText(n2).then(() => {
      const n3 = this.shadow.querySelector(".copy-button");
      n3 && (n3.classList.add("copied"), n3.setAttribute("aria-label", "Copied!"), this._copyTimeout && clearTimeout(this._copyTimeout), this._copyTimeout = setTimeout(() => {
        n3.classList.remove("copied"), n3.setAttribute("aria-label", "Copy code to clipboard"), this._copyTimeout = null;
      }, 2e3));
    }).catch(() => {
    });
  }
  highlightSyntax(n2, e2) {
    switch (e2) {
      case "html":
        return this.highlightHtml(n2);
      case "scss":
        return this.highlightScss(n2);
      case "typescript":
        return this.highlightTypeScript(n2);
      case "shell":
        return this.highlightShell(n2);
    }
  }
  escapeHtml(n2) {
    return n2.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  highlightHtml(n2) {
    let e2 = this.escapeHtml(n2);
    return e2 = e2.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="token-comment">$1</span>'), e2 = e2.replace(/(&lt;\/?)([\w-]+)/g, '<span class="token-tag">$1$2</span>'), e2 = e2.replace(/(\/?&gt;)/g, '<span class="token-tag">$1</span>'), e2 = e2.replace(/(key)(=)(&quot;)(.*?)(&quot;)/g, '<span class="token-attr-name">$1</span><span class="token-punctuation">$2</span><span class="token-attr-value">$3</span><span class="token-binding-key">$4</span><span class="token-attr-value">$5</span>'), e2 = e2.replace(/(\[[\w.-]+\]|\([\w.-]+\)|[\w-]+)(=)(&quot;.*?&quot;)/g, '<span class="token-attr-name">$1</span><span class="token-punctuation">$2</span><span class="token-attr-value">$3</span>'), e2;
  }
  highlightScss(n2) {
    let e2 = this.escapeHtml(n2);
    return e2 = e2.replace(/(\/\/.*)$/gm, '<span class="token-comment">$1</span>'), e2 = e2.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="token-comment">$1</span>'), e2 = e2.replace(/(@[\w-]+)/g, '<span class="token-keyword">$1</span>'), e2 = e2.replace(/(\$[\w-]+)/g, '<span class="token-variable">$1</span>'), e2 = e2.replace(/(&#39;.*?&#39;)/g, '<span class="token-string">$1</span>'), e2 = e2.replace(/([\w-]+)(\()/g, '<span class="token-function">$1</span><span class="token-punctuation">$2</span>'), e2 = e2.replace(/([\w-]+)(\s*:)(?![^<]*<\/span>)/g, '<span class="token-property">$1</span><span class="token-punctuation">$2</span>'), e2 = e2.replace(/(\))/g, '<span class="token-punctuation">$1</span>'), e2 = e2.replace(/([{},])/g, '<span class="token-punctuation">$1</span>'), e2 = e2.replace(/(\d+(?:\.\d+)?)(px|em|rem|%)/g, '<span class="token-number">$1$2</span>'), e2;
  }
  highlightTypeScript(n2) {
    const e2 = /* @__PURE__ */ new Map();
    let t2 = 0, i2 = n2.replace(/'([^'\\]|\\.)*'/g, (n3) => {
      const i3 = `__STRING_${t2++}__`;
      return e2.set(i3, `<span class="token-string">${this.escapeHtml(n3)}</span>`), i3;
    });
    i2 = i2.replace(/"([^"\\]|\\.)*"/g, (n3) => {
      const i3 = `__STRING_${t2++}__`;
      return e2.set(i3, `<span class="token-string">${this.escapeHtml(n3)}</span>`), i3;
    }), i2 = i2.replace(/`[^`]*`/g, (n3) => {
      const i3 = `__STRING_${t2++}__`;
      let a3 = this.escapeHtml(n3);
      return a3 = a3.replace(/(&lt;\/?)([\w-]+)/g, '<span class="token-tag">$1$2</span>'), a3 = a3.replace(/(\/?&gt;)/g, '<span class="token-tag">$1</span>'), a3 = a3.replace(/([\w-]+)(=)(&quot;[^&]*&quot;)/g, '<span class="token-attr-name">$1</span><span class="token-punctuation">$2</span><span class="token-attr-value">$3</span>'), e2.set(i3, `<span class="token-template-string">${a3}</span>`), i3;
    });
    let a2 = this.escapeHtml(i2);
    a2 = a2.replace(/(\/\/.*)$/gm, '<span class="token-comment">$1</span>'), a2 = a2.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="token-comment">$1</span>'), a2 = a2.replace(/(&#64;\w+)/g, '<span class="token-decorator">$1</span>');
    const s = new RegExp(`\\b(${["import", "export", "from", "class", "interface", "type", "const", "let", "var", "function", "return", "if", "else", "for", "while", "new", "this", "extends", "implements", "public", "private", "protected", "readonly", "static", "async", "await", "as"].join("|")})\\b(?!=)`, "g");
    a2 = a2.replace(s, '<span class="token-keyword">$1</span>'), a2 = a2.replace(/(:\s*)([A-Z][\w&lt;&gt;\[\]]+)/g, '$1<span class="token-type">$2</span>'), a2 = a2.replace(/(class|interface|extends|implements)(\s+)([A-Z]\w*)/g, '$1$2<span class="token-class-name">$3</span>'), a2 = a2.replace(/\b(\d+)\b/g, '<span class="token-number">$1</span>'), a2 = a2.replace(/([{}\[\]().,:])/g, '<span class="token-punctuation">$1</span>');
    for (const [o, r] of e2) a2 = a2.replace(o, r);
    return a2;
  }
  highlightShell(n2) {
    let e2 = this.escapeHtml(n2);
    return e2 = e2.replace(/(#.*)$/gm, '<span class="token-comment">$1</span>'), e2 = e2.replace(/^(\s*)(\w+)/gm, '$1<span class="token-function">$2</span>'), e2 = e2.replace(/(\s)(--?[\w-]+)/g, '$1<span class="token-variable">$2</span>'), e2 = e2.replace(/(&#39;.*?&#39;)/g, '<span class="token-string">$1</span>'), e2 = e2.replace(/(&quot;.*?&quot;)/g, '<span class="token-string">$1</span>'), e2 = e2.replace(/(install|add)(\s+)([@\w\/-]+)/g, '$1$2<span class="token-string">$3</span>'), e2;
  }
  getStyles() {
    return `
      /* Color-scheme: inherit from parent by default, attribute overrides */
      :host([color-scheme="light"]) { color-scheme: light; }
      :host([color-scheme="dark"]) { color-scheme: dark; }

      :host {
        display: block;
        --code-interactive-color: inherit;
        --code-interactive-bg-color: transparent;
        --code-interactive-border-color: var(--code-interactive-highlight, light-dark(#20999d, #769aa5));
      }

      .code-block {
        margin: 0;
        padding: 16px;
        background: var(--code-bg, light-dark(#ffffff, #2b2d30));
        color: var(--code-text, light-dark(#000000, #a9b7c6));
        border-radius: var(--code-border-radius, 8px);
        overflow-x: auto;
        font-family: 'Fira Code', 'Consolas', 'Monaco', monospace;
        font-size: 13px;
        line-height: 1.5;
        position: relative;
      }

      .code-block code {
        display: block;
      }

      .code-line {
        display: block;
        min-height: 1.5em;
      }

      .section-separator {
        display: block;
        height: 1px;
        background: var(--code-separator-color, light-dark(rgba(0,0,0,0.1), rgba(255,255,255,0.1)));
        margin: 8px 0;
      }

      .indent {
        white-space: pre;
      }

      .line-disabled {
        color: var(--code-comment-color, #808080);
      }

      .line-disabled [class*="token-"] {
        color: inherit;
      }

      /* Token colors — IntelliJ (Light / Darcula) defaults */
      .token-keyword { color: var(--token-keyword, light-dark(#000080, #cc7832)); }
      .token-string { color: var(--token-string, light-dark(#008000, #6a8759)); }
      .token-number { color: var(--token-number, light-dark(#0000ff, #6897bb)); }
      .token-comment { color: var(--token-comment, #808080); }
      .token-tag { color: var(--token-tag, light-dark(#000080, #e8bf6a)); }
      .token-attr-name { color: var(--token-attr-name, light-dark(#0000ff, #bababa)); }
      .token-attr-value { color: var(--token-attr-value, light-dark(#008000, #6a8759)); }
      .token-punctuation { color: var(--token-punctuation, light-dark(#000000, #a9b7c6)); }
      .token-property { color: var(--token-property, light-dark(#660e7a, #9876aa)); }
      .token-variable { color: var(--token-variable, light-dark(#000000, #a9b7c6)); }
      .token-function { color: var(--token-function, light-dark(#00627a, #ffc66d)); }
      .token-decorator { color: var(--token-decorator, light-dark(#808000, #bbb529)); }
      .token-type { color: var(--token-type, light-dark(#20999d, #769aa5)); }
      .token-class-name { color: var(--token-class-name, light-dark(#20999d, #769aa5)); }
      .token-template-string { color: var(--token-template-string, light-dark(#008000, #6a8759)); }
      .token-value { color: var(--token-value, light-dark(#000000, #a9b7c6)); }
      .token-unknown { color: var(--token-unknown, light-dark(#20999d, #769aa5)); }
      .token-binding-key { color: var(--token-binding-key, light-dark(#20999d, #769aa5)); }

      /* Interactive controls — decoration customizable via CSS custom properties and ::part(interactive) */
      .inline-control {
        cursor: pointer;
        transition: background 0.15s ease;
        color: var(--code-interactive-color, inherit);
        text-decoration: var(--code-interactive-text-decoration, underline wavy var(--code-interactive-highlight, light-dark(#20999d, #769aa5)));
        text-underline-offset: var(--code-interactive-text-underline-offset, 3px);
        border-radius: var(--code-interactive-border-radius, 3px);
        border: var(--code-interactive-border, none);
        outline: var(--code-interactive-outline, none);
        outline-offset: var(--code-interactive-outline-offset, 0px);
        background: var(--code-interactive-background, transparent);
      }

      .inline-control:hover {
        background: var(--code-hover-bg, light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.1)));
        box-shadow: var(--code-interactive-hover-shadow, none);
      }

      .inline-control:focus-visible {
        outline: 2px solid var(--code-focus-outline, light-dark(#0065a9, #214283));
        outline-offset: 1px;
      }

      .inline-control.disabled {
        opacity: 0.5;
        text-decoration: none;
        cursor: default;
      }

      .inline-control.disabled:hover {
        background: transparent;
      }

      .line-toggle,
      .block-toggle {
        margin-right: 4px;
        padding: var(--code-interactive-padding, 0 2px);
      }

      .block-end {
        margin-left: 4px;
        padding: 0 2px;
      }

      .line-toggle-inactive,
      .block-toggle-inactive,
      .block-end.block-toggle-inactive {
        opacity: 0.3;
        color: var(--code-comment-color, #808080);
      }

      .line-toggle-active,
      .block-toggle-active,
      .block-end.block-toggle-active {
        color: var(--code-interactive-highlight, light-dark(#20999d, #769aa5));
      }

      /* Attribute binding - strikethrough when disabled */
      .inline-attribute {
        padding: var(--code-interactive-padding, 0 2px);
      }

      .inline-attribute.attribute-disabled {
        text-decoration: line-through;
        opacity: 0.6;
      }

      .inline-boolean,
      .inline-number,
      .inline-string,
      .inline-select-toggle,
      .inline-select-carousel {
        padding: var(--code-interactive-padding, 0 4px);
        position: relative;
      }

      .inline-number-input,
      .inline-string-input {
        position: absolute;
        opacity: 0;
        width: 60px;
        left: 0;
        top: 0;
        height: 100%;
        font: inherit;
        background: var(--code-input-bg, light-dark(#f2f2f2, #313335));
        border: 1px solid var(--code-input-border, light-dark(rgba(0,0,0,0.2), rgba(255,255,255,0.2)));
        color: var(--token-number, light-dark(#0000ff, #6897bb));
        border-radius: 3px;
        padding: 0 4px;
        pointer-events: none;
      }

      .inline-number:focus-within .inline-number-input,
      .inline-number-input:focus,
      .inline-string:focus-within .inline-string-input,
      .inline-string-input:focus {
        opacity: 1;
        pointer-events: auto;
        outline: none;
        border-color: var(--code-focus-outline, light-dark(#0065a9, #214283));
      }

      .inline-string-input {
        width: 120px;
        color: var(--token-string, light-dark(#008000, #6a8759));
      }

      .inline-select-wrapper {
        padding: 0 4px;
        position: relative;
        display: inline-block;
      }

      .inline-select-input {
        position: absolute;
        opacity: 0;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        min-width: 120px;
        font: inherit;
        background: var(--code-input-bg, light-dark(#f2f2f2, #313335));
        border: 1px solid var(--code-input-border, light-dark(rgba(0,0,0,0.2), rgba(255,255,255,0.2)));
        color: var(--token-string, light-dark(#008000, #6a8759));
        border-radius: 3px;
        padding: 2px 4px;
        pointer-events: none;
        cursor: pointer;
      }

      .inline-select-wrapper:focus-within .inline-select-input,
      .inline-select-input:focus {
        opacity: 1;
        pointer-events: auto;
        outline: none;
        border-color: var(--code-focus-outline, light-dark(#0065a9, #214283));
        z-index: 10;
      }

      .inline-color {
        padding: 0 4px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .inline-color input[type="color"] {
        position: absolute;
        opacity: 0;
        width: 0;
        height: 0;
        pointer-events: none;
      }

      .color-preview {
        display: inline-block;
        width: 12px;
        height: 12px;
        border-radius: 2px;
        border: 1px solid var(--code-color-preview-border, light-dark(rgba(0,0,0,0.2), rgba(255,255,255,0.3)));
        vertical-align: middle;
      }

      /* Copy button - hidden by default, shown with show-copy attribute */
      .copy-button {
        position: absolute;
        top: 8px;
        right: 8px;
        background: transparent;
        border: 1px solid var(--code-copy-border, light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.2)));
        border-radius: 4px;
        color: var(--code-copy-color, light-dark(rgba(0,0,0,0.4), rgba(255,255,255,0.5)));
        cursor: pointer;
        padding: 4px;
        display: none;
        align-items: center;
        justify-content: center;
        transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
        z-index: 10;
        line-height: 0;
      }

      :host([show-copy]) .copy-button {
        display: flex;
      }

      .copy-button:hover {
        color: var(--code-text, light-dark(#000000, #a9b7c6));
        border-color: var(--code-copy-color, light-dark(rgba(0,0,0,0.4), rgba(255,255,255,0.5)));
        background: var(--code-hover-bg, light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.1)));
      }

      .copy-button:focus-visible {
        outline: 2px solid var(--code-focus-outline, light-dark(#0065a9, #214283));
        outline-offset: 1px;
      }

      .copy-button .check-icon {
        display: none;
      }

      .copy-button.copied .copy-icon {
        display: none;
      }

      .copy-button.copied .check-icon {
        display: block;
      }

      .copy-button.copied {
        color: var(--code-copy-accent, light-dark(#20999d, #769aa5));
        border-color: var(--code-copy-accent, light-dark(#20999d, #769aa5));
      }

      /* Line numbers */
      .line-number {
        display: inline-block;
        min-width: 2em;
        text-align: right;
        color: var(--code-line-number, light-dark(rgba(0,0,0,0.3), rgba(255,255,255,0.25)));
        user-select: none;
        padding-right: 1em;
        font-variant-numeric: tabular-nums;
      }
    `;
  }
};
t.observedAttributes = ["show-line-numbers", "color-scheme"];
var i = t;
function a() {
  customElements.get("code-binding") || customElements.define("code-binding", e), customElements.get("interactive-code") || customElements.define("interactive-code", i);
}
a();
export {
  e as CodeBindingElement,
  i as InteractiveCodeElement,
  a as registerInteractiveCode
};
//# sourceMappingURL=@softwarity_interactive-code.js.map
