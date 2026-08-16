import { api } from "../../scripts/api.js";
import {
  applyManagedUpdate,
  classifyTrigger,
  discoverActiveLoras,
  discoverPromptTargets,
  ensureExtensionState,
  inferLoraCategory,
  LORA_CATEGORIES,
  selectedTexts,
  stopManaging,
  undoManagedUpdate,
} from "./lctc-core.js";

const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "checked") node.checked = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};

async function jsonRequest(path, options) {
  const response = await api.fetchApi(path, options);
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function emptyProfile(info) {
  return { schemaVersion: 1, fileHash: info.fileHash, displayName: info.displayName, baseModel: info.baseModel, category: inferLoraCategory(info.displayName, info.metadata), categoryConfirmed: false, sources: ["user"], groups: [] };
}

function slug(label, used) {
  const base = label.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "group";
  let id = base;
  for (let index = 2; used.has(id); index += 1) id = `${base}-${index}`;
  return id;
}

export class LctcPanel {
  constructor(app, onActivityChange = () => {}) {
    this.app = app;
    this.onActivityChange = onActivityChange;
    this.info = null;
    this.profile = null;
    this.selections = {};
    this.ownerKey = null;
    this.loraStates = new Map();
    this.loraCategories = new Map();
    this.root = el("aside", { class: "lctc-panel", "aria-label": "LoRA Contextual Trigger Controller" });
    this.root.hidden = true;
    document.body.append(this.root);
    this.render();
  }

  toggle() { this.root.hidden = !this.root.hidden; if (!this.root.hidden) this.refresh(); }
  message(text, error = false) { this.status.textContent = text; this.status.dataset.error = error ? "true" : "false"; }

  async refresh() {
    const loras = discoverActiveLoras(this.app.graph);
    const selectedName = this.loraSelect?.value;
    this.loras = loras;
    for (const lora of loras) {
      if (!this.loraCategories.has(lora.name)) this.loraCategories.set(lora.name, { category: inferLoraCategory(lora.name), confirmed: false });
    }
    this.render();
    this.reportActivity();
    if (selectedName && loras.some((item) => item.name === selectedName)) this.loraSelect.value = selectedName;
    if (!loras.length) this.message("No compatible active LoRA was detected.");
  }

  render() {
    this.root.replaceChildren();
    const close = el("button", { class: "lctc-close", onClick: () => { this.root.hidden = true; }, title: "Close" }, "×");
    this.root.append(el("header", {}, el("div", {}, el("strong", {}, "Contextual Triggers"), el("small", {}, "Local-first · human review")), close));
    const loras = this.loras || discoverActiveLoras(this.app.graph);
    this.loraSelect = el("select", { onChange: () => this.loadSelected() }, el("option", { value: "" }, "Select a LoRA…"));
    for (const lora of loras) this.loraSelect.append(el("option", { value: lora.name }, this.loraOptionLabel(lora)));
    const refresh = el("button", { onClick: () => this.refresh() }, "Refresh");
    this.activitySummary = el("div", { class: "lctc-activity-summary" });
    this.root.append(el("section", { class: "lctc-picker" }, el("div", { class: "lctc-row" }, this.loraSelect, refresh), this.activitySummary));
    this.updateActivitySummary();
    this.content = el("main", {});
    this.root.append(this.content);
    this.status = el("div", { class: "lctc-status", role: "status" }, "Ready.");
    this.root.append(this.status);
  }

  async loadSelected() {
    const name = this.loraSelect.value;
    if (!name) return;
    this.message("Reading the header and calculating SHA-256…");
    try {
      this.info = await jsonRequest(`/lctc/v1/lora?name=${encodeURIComponent(name)}`);
      this.profile = this.info.profile || emptyProfile(this.info);
      if (!this.profile.category || (this.profile.category === "Unknown" && !this.profile.categoryConfirmed)) {
        this.profile.category = inferLoraCategory(name, this.info.metadata, this.profile.groups);
        this.profile.categoryConfirmed = false;
      }
      this.loraCategories.set(name, { category: this.profile.category, confirmed: Boolean(this.profile.categoryConfirmed) });
      this.ownerKey = `${this.info.fileHash}:${this.loras.find((item) => item.name === name)?.nodeId || "unknown"}`;
      const saved = ensureExtensionState(this.app.graph).loras[this.ownerKey];
      this.selections = saved?.selections || {};
      const hasProfile = Boolean(this.info.profile);
      const hasGroups = Boolean(this.profile.groups?.length);
      const hasMetadataWords = this.hasImportableWords(this.info.metadata || {});
      this.loraStates.set(name, hasProfile && hasGroups ? "ready" : hasMetadataWords ? "review" : "unknown");
      this.updateLoraOptionLabels();
      this.updateActivitySummary();
      this.reportActivity();
      this.renderProfile();
      this.message(this.info.profile ? "Local profile loaded." : "No saved profile. Create or import groups, review them, then save.");
    } catch (error) { this.message(error.message, true); }
  }

  loraOptionLabel(lora) {
    const state = this.loraStates.get(lora.name) || "detected";
    const type = this.loraCategories.get(lora.name) || { category: "Unknown", confirmed: false };
    if (type.confirmed) return `[${type.category}] ${lora.name}`;
    const prefix = { ready: "● Ready", review: "◆ Review", unknown: "! Unknown", classified: "● Classified", detected: "• Detected" }[state];
    const typeLabel = `[${type.category}${type.confirmed ? "" : "?"}]`;
    return `${prefix} — ${typeLabel} ${lora.name} · ${lora.source}`;
  }

  updateLoraOptionLabels() {
    if (!this.loraSelect) return;
    for (const option of this.loraSelect.options) {
      if (!option.value) continue;
      const lora = (this.loras || []).find((item) => item.name === option.value);
      if (lora) option.textContent = this.loraOptionLabel(lora);
    }
  }

  activityCounts() {
    const counts = { active: (this.loras || []).length, ready: 0, review: 0, unknown: 0, classified: 0 };
    for (const lora of this.loras || []) {
      const state = this.loraStates.get(lora.name);
      if (state && Object.hasOwn(counts, state)) counts[state] += 1;
    }
    return counts;
  }

  reportActivity() { this.onActivityChange(this.activityCounts()); }

  updateActivitySummary() {
    if (!this.activitySummary) return;
    const counts = this.activityCounts();
    if (!counts.active) {
      this.activitySummary.textContent = "No active LoRAs detected.";
      this.activitySummary.dataset.state = "idle";
      return;
    }
    const details = [];
    if (counts.ready) details.push(`${counts.ready} ready`);
    if (counts.review) details.push(`${counts.review} to review`);
    if (counts.unknown) details.push(`${counts.unknown} without known words`);
    if (counts.classified) details.push(`${counts.classified} classified`);
    const uninspected = counts.active - counts.ready - counts.review - counts.unknown - counts.classified;
    if (uninspected) details.push(`${uninspected} to inspect`);
    this.activitySummary.textContent = `${counts.active} active LoRA${counts.active === 1 ? "" : "s"} detected · ${details.join(" · ")}`;
    this.activitySummary.dataset.state = counts.ready ? "ready" : counts.review ? "review" : "active";
  }

  hasImportableWords(metadata) {
    for (const key of ["ss_tag_frequency", "modelspec.tags", "trigger_words", "trainedWords"]) {
      const value = metadata[key];
      if ((Array.isArray(value) && value.length) || (value && typeof value === "object" && Object.keys(value).length) || (typeof value === "string" && value.trim())) return true;
    }
    return false;
  }

  renderProfile() {
    this.content.replaceChildren();
    const title = el("div", { class: "lctc-summary" },
      el("strong", {}, this.profile.displayName),
      el("span", {}, `${this.profile.baseModel} · ${this.info.fileHash.slice(0, 12)}…`),
    );
    const targetSelect = el("select", {});
    const targets = discoverPromptTargets(this.app.graph);
    const extensionState = ensureExtensionState(this.app.graph);
    for (const target of targets) targetSelect.append(el("option", { value: target.id }, target.label));
    targetSelect.value = extensionState.targetId || targets[0]?.id || "";
    this.targetSelect = targetSelect;
    const categorySelect = el("select", { "aria-label": "LoRA type" });
    for (const category of LORA_CATEGORIES) categorySelect.append(el("option", { value: category }, category));
    categorySelect.value = this.profile.category || "Unknown";
    const confirmCategory = el("button", { class: "lctc-confirm-type", type: "button" }, this.profile.categoryConfirmed ? "Confirmed ✓" : "Confirm type");
    confirmCategory.disabled = Boolean(this.profile.categoryConfirmed);
    categorySelect.addEventListener("change", () => {
      this.profile.category = categorySelect.value;
      this.profile.categoryConfirmed = false;
      this.loraCategories.set(this.loraSelect.value, { category: categorySelect.value, confirmed: false });
      confirmCategory.disabled = false;
      confirmCategory.textContent = "Confirm type";
      this.updateLoraOptionLabels();
    });
    confirmCategory.addEventListener("click", () => this.confirmCategory(categorySelect, confirmCategory));
    this.content.append(title,
      el("label", { class: "lctc-field" }, "LoRA type", el("div", { class: "lctc-type-row" }, categorySelect, confirmCategory)),
      el("label", { class: "lctc-field" }, "Positive prompt", targetSelect),
    );

    const groups = el("div", { class: "lctc-groups" });
    this.profile.groups.forEach((group, index) => groups.append(this.renderGroup(group, index)));
    this.content.append(groups);

    const addGroup = el("button", { onClick: () => this.addGroup() }, "+ Group");
    const trained = el("button", { onClick: () => this.importEmbeddedWords() }, "Import local words");
    const civitai = el("button", { onClick: () => this.lookupCivitai() }, "Look up on Civitai…");
    this.content.append(el("div", { class: "lctc-actions" }, addGroup, trained, civitai));
    this.content.append(el("div", { class: "lctc-actions" },
      el("button", { class: "primary", onClick: () => this.sync() }, "Sync"),
      el("button", { onClick: () => this.save() }, "Save profile"),
      el("button", { onClick: () => this.undo() }, "Undo"),
      el("button", { onClick: () => { stopManaging(this.app.graph, this.ownerKey); this.message("Ownership removed; no prompt text was changed."); } }, "Stop managing"),
    ));
  }

  async confirmCategory(categorySelect, button) {
    try {
      button.disabled = true;
      button.textContent = "Saving…";
      this.profile.category = categorySelect.value;
      this.profile.categoryConfirmed = true;
      this.profile = await jsonRequest(`/lctc/v1/profile/${this.info.fileHash}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.profile),
      });
      this.info.profile = this.profile;
      this.loraCategories.set(this.loraSelect.value, { category: this.profile.category, confirmed: true });
      this.loraStates.set(this.loraSelect.value, this.profile.groups.length ? "ready" : "classified");
      this.updateLoraOptionLabels();
      this.updateActivitySummary();
      this.reportActivity();
      button.textContent = "Confirmed ✓";
      this.message(`LoRA type saved as ${this.profile.category}.`);
    } catch (error) {
      this.profile.categoryConfirmed = false;
      button.disabled = false;
      button.textContent = "Confirm type";
      this.message(error.message, true);
    }
  }

  renderGroup(group, groupIndex) {
    const fieldset = el("fieldset", { class: "lctc-group" });
    const label = el("input", { value: group.label, "aria-label": "Group name" });
    label.addEventListener("change", () => { group.label = label.value.trim() || group.label; });
    const exclusive = el("input", { type: "checkbox", checked: group.exclusive });
    exclusive.addEventListener("change", () => { group.exclusive = exclusive.checked; this.renderProfile(); });
    fieldset.append(el("legend", {}, label), el("label", { class: "lctc-inline" }, exclusive, " Exclusive"));
    const chosen = this.selections[group.id];
    if (group.exclusive && !group.required) {
      const automatic = el("input", { type: "radio", name: `${this.ownerKey}-${group.id}`, value: "" });
      automatic.checked = !chosen;
      automatic.addEventListener("change", () => { if (automatic.checked) this.selections[group.id] = null; });
      fieldset.append(el("label", { class: "lctc-option lctc-automatic" }, automatic, el("span", {}, "Automatic / none")));
    }
    for (const [optionIndex, option] of group.options.entries()) {
      const input = el("input", { type: group.exclusive ? "radio" : "checkbox", name: `${this.ownerKey}-${group.id}`, value: option.text });
      input.checked = group.exclusive ? chosen === option.text : Array.isArray(chosen) && chosen.includes(option.text);
      input.addEventListener("change", () => {
        if (group.exclusive) this.selections[group.id] = input.checked ? option.text : null;
        else {
          const values = new Set(Array.isArray(this.selections[group.id]) ? this.selections[group.id] : []);
          input.checked ? values.add(option.text) : values.delete(option.text);
          this.selections[group.id] = [...values];
        }
      });
      const mirrorsText = option.label.trim() === option.text.trim();
      const visibleLabel = mirrorsText ? null : el("button", {
        class: "lctc-option-label",
        type: "button",
        title: "Click to edit the visible label",
        onClick: () => {
          const next = window.prompt("Visible label", option.label);
          if (next?.trim()) { option.label = next.trim(); this.renderProfile(); }
        },
      }, option.label);
      const textInput = el("input", { value: option.text, "aria-label": "Exact trigger text" });
      textInput.addEventListener("change", () => {
        const next = textInput.value.trim();
        if (!next || group.options.some((candidate) => candidate !== option && candidate.text === next)) { textInput.value = option.text; return; }
        const previous = option.text;
        option.text = next;
        if (mirrorsText) option.label = next;
        if (group.exclusive && this.selections[group.id] === previous) this.selections[group.id] = next;
        if (!group.exclusive && Array.isArray(this.selections[group.id])) this.selections[group.id] = this.selections[group.id].map((value) => value === previous ? next : value);
      });
      const remove = el("button", { class: "icon", title: "Remove option", type: "button", onClick: (event) => { event.preventDefault(); group.options.splice(optionIndex, 1); this.renderProfile(); } }, "−");
      fieldset.append(el("div", { class: `lctc-option ${visibleLabel ? "lctc-option-labeled" : "lctc-option-single"}` }, input, ...(visibleLabel ? [visibleLabel] : []), textInput, remove));
    }
    fieldset.append(el("div", { class: "lctc-actions" },
      el("button", { onClick: () => this.addOption(group) }, "+ Option"),
      el("button", { onClick: () => { this.profile.groups.splice(groupIndex, 1); delete this.selections[group.id]; this.renderProfile(); } }, "Remove group"),
    ));
    return fieldset;
  }

  addGroup() {
    const label = window.prompt("Group name (for example: Position)");
    if (!label?.trim()) return;
    const used = new Set(this.profile.groups.map((group) => group.id));
    this.profile.groups.push({ id: slug(label, used), label: label.trim(), exclusive: true, required: false, options: [] });
    this.renderProfile();
  }

  addOption(group, presetText = "") {
    const text = presetText || window.prompt("Exact trigger text");
    if (!text?.trim() || group.options.some((option) => option.text === text.trim())) return;
    const label = presetText || window.prompt("Visible label", text.trim()) || text.trim();
    group.options.push({ label: label.trim(), text: text.trim(), provenance: presetText ? "embedded" : "user", confidence: presetText ? 0.4 : 1 });
    if (!presetText) this.renderProfile();
  }

  importSuggestions(words, provenance) {
    let added = 0;
    for (const word of words) {
      if (typeof word !== "string" || !word.trim()) continue;
      const text = word.trim();
      const classification = classifyTrigger(text);
      let group = this.profile.groups.find((candidate) => candidate.id === classification.id);
      if (!group) {
        group = { id: classification.id, label: classification.label, exclusive: classification.exclusive, required: false, options: [] };
        this.profile.groups.push(group);
      }
      if (group.options.some((option) => option.text === text)) continue;
      group.options.push({ label: text, text, provenance, confidence: classification.confidence });
      added += 1;
    }
    return added;
  }

  importEmbeddedWords() {
    const metadata = this.info.metadata || {};
    const words = new Set();
    const collectObjectLeaves = (value, depth = 0) => {
      if (!value || typeof value !== "object" || depth > 4) return;
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === "number") words.add(key);
        else if (typeof child === "object") collectObjectLeaves(child, depth + 1);
      }
    };
    for (const key of ["ss_tag_frequency", "modelspec.tags", "trigger_words", "trainedWords"]) {
      const value = metadata[key];
      if (Array.isArray(value)) value.forEach((word) => typeof word === "string" && words.add(word));
      else if (value && typeof value === "object") collectObjectLeaves(value);
      else if (typeof value === "string") value.split(/[,\n]/).forEach((word) => word.trim() && words.add(word.trim()));
    }
    if (!words.size) return this.message("No structured trained words were found in the header.", true);
    if (!this.profile.sources.includes("embedded")) this.profile.sources.push("embedded");
    const added = this.importSuggestions([...words].slice(0, 200), "embedded");
    if (added) this.loraStates.set(this.loraSelect.value, "review");
    this.updateLoraOptionLabels();
    this.updateActivitySummary();
    this.reportActivity();
    this.renderProfile();
    this.message(`${added} words were grouped as unselected suggestions. Review, reorganize, and save them.`);
  }

  async lookupCivitai() {
    if (!window.confirm("Send only this LoRA's SHA-256 hash to Civitai to look up public metadata?")) return;
    try {
      this.message("Looking up metadata on Civitai…");
      const data = await jsonRequest(`/lctc/v1/civitai/${this.info.fileHash}`, { method: "POST" });
      if (!this.profile.sources.includes("publisher")) this.profile.sources.push("publisher");
      const added = this.importSuggestions(data.trainedWords, "publisher");
      if (added) this.loraStates.set(this.loraSelect.value, "review");
      if (data.baseModel) this.profile.baseModel = data.baseModel;
      this.renderProfile();
      this.updateLoraOptionLabels();
      this.updateActivitySummary();
      this.reportActivity();
      this.message(`${added} public words were grouped for review.`);
    } catch (error) { this.message(error.message, true); }
  }

  sync() {
    try {
      const target = discoverPromptTargets(this.app.graph).find((item) => item.id === this.targetSelect.value);
      if (!target) throw new Error("Select an editable positive prompt field.");
      const missing = this.profile.groups.filter((group) => group.required && !(Array.isArray(this.selections[group.id]) ? this.selections[group.id].length : this.selections[group.id]));
      if (missing.length) throw new Error(`Select a required option in: ${missing.map((group) => group.label).join(", ")}.`);
      const state = ensureExtensionState(this.app.graph);
      state.loras[this.ownerKey] ||= {};
      state.loras[this.ownerKey].selections = structuredClone(this.selections);
      applyManagedUpdate(this.app.graph, target, this.ownerKey, selectedTexts(this.profile, this.selections));
      this.app.graph.change?.();
      this.message("Only the managed prompt segment was synchronized.");
    } catch (error) { this.message(error.message, true); }
  }

  async save() {
    try {
      this.message("Saving the local profile…");
      this.profile = await jsonRequest(`/lctc/v1/profile/${this.info.fileHash}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.profile) });
      this.loraStates.set(this.loraSelect.value, this.profile.groups.length ? "ready" : "unknown");
      this.renderProfile();
      this.updateLoraOptionLabels();
      this.updateActivitySummary();
      this.reportActivity();
      this.message("Confirmed profile saved locally by SHA-256 hash.");
    } catch (error) { this.message(error.message, true); }
  }

  undo() {
    try { undoManagedUpdate(this.app.graph); this.app.graph.change?.(); this.message("The exact previous prompt value was restored."); }
    catch (error) { this.message(error.message, true); }
  }
}
