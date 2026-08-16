export const EXTENSION_KEY = "lctc";
export const LORA_CATEGORIES = ["Unknown", "Character", "Pose", "Clothing", "Style", "Lighting", "Camera", "Expression", "Slider", "Utility", "Concept"];

const CATEGORY_RULES = [
  { category: "Lighting", terms: ["lighting", "illumination", "relight", "backlight", "rim light", "light control", "shadows"] },
  { category: "Pose", terms: ["pose", "poses", "position", "posture", "standing", "sitting", "lying", "kneeling", "crouching", "squatting", "challenge"] },
  { category: "Clothing", terms: ["clothing", "clothes", "outfit", "dress", "uniform", "costume", "shirt", "skirt", "pants", "swimsuit", "bikini", "armor"] },
  { category: "Camera", terms: ["camera", "angle", "pov", "close up", "closeup", "wide shot", "fisheye", "lens"] },
  { category: "Expression", terms: ["expression", "emotion", "smile", "crying", "angry", "face control"] },
  { category: "Slider", terms: ["slider", "adjuster", "concept slider"] },
  { category: "Utility", terms: ["utility", "detailer", "add detail", "noise", "fix", "helper"] },
  { category: "Style", terms: ["style", "aesthetic", "watercolor", "oil painting", "sketch", "lineart", "pixel art", "rendering"] },
  { category: "Character", terms: ["character", "char", "person", "hero", "villain"] },
  { category: "Concept", terms: ["concept", "effect", "object", "prop"] },
];

export function inferLoraCategory(name, metadata = {}, groups = []) {
  const metadataText = ["modelspec.title", "modelspec.description", "modelspec.tags", "ss_output_name"]
    .map((key) => metadata[key])
    .filter((value) => typeof value === "string")
    .join(" ");
  const groupText = groups.map((group) => `${group.id || ""} ${group.label || ""}`).join(" ");
  const normalized = `${name || ""} ${metadataText} ${groupText}`.toLowerCase().replace(/[_./\\-]+/g, " ").replace(/\s+/g, " ");
  for (const rule of CATEGORY_RULES) {
    if (rule.terms.some((term) => new RegExp(`(?:^|\\s)${term.replace(/ /g, "\\s+")}(?:$|\\s)`, "i").test(normalized))) return rule.category;
  }
  return "Unknown";
}

const CONTEXT_RULES = [
  { id: "position", label: "Position (review)", exclusive: true, confidence: 0.82, terms: ["standing", "sitting", "seated", "lying", "kneeling", "crouching", "squatting"] },
  { id: "camera-angle", label: "Camera angle (review)", exclusive: true, confidence: 0.82, terms: ["from above", "from below", "high angle", "low angle", "dutch angle", "eye level", "overhead view"] },
  { id: "orientation", label: "Orientation (review)", exclusive: true, confidence: 0.78, terms: ["front view", "side view", "back view", "rear view", "three quarter view", "profile view", "facing viewer"] },
  { id: "distance", label: "Distance/framing (review)", exclusive: true, confidence: 0.8, terms: ["close up", "closeup", "portrait", "upper body", "cowboy shot", "full body", "wide shot", "long shot"] },
  { id: "expression", label: "Expression (review)", exclusive: true, confidence: 0.72, terms: ["smile", "smiling", "frown", "frowning", "angry", "crying", "laughing", "surprised", "expressionless"] },
  { id: "outfit", label: "Outfit (review)", exclusive: false, confidence: 0.68, terms: ["dress", "uniform", "swimsuit", "jacket", "shirt", "skirt", "pants", "costume", "outfit"] },
  { id: "style", label: "Style (review)", exclusive: false, confidence: 0.68, terms: ["watercolor", "oil painting", "sketch", "lineart", "pixel art", "anime style", "realistic", "photorealistic"] },
];

export function classifyTrigger(text) {
  const normalized = String(text).toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  for (const rule of CONTEXT_RULES) {
    if (rule.terms.some((term) => new RegExp(`(?:^|\\s)${term.replace(/ /g, "\\s+")}(?:$|\\s)`, "i").test(normalized))) {
      return { id: rule.id, label: rule.label, exclusive: rule.exclusive, confidence: rule.confidence };
    }
  }
  return { id: "unclassified", label: "Unclassified (review)", exclusive: false, confidence: 0.35 };
}

const CORE_LORA_TYPES = new Set(["LoraLoader", "LoraLoaderModelOnly"]);

function widgetValue(node, names) {
  const wanted = names.map((name) => name.toLowerCase());
  return node.widgets?.find((widget) => wanted.includes(String(widget.name || "").toLowerCase()))?.value;
}

function numeric(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedLora(name, node, strength = 1, source = "unknown") {
  if (typeof name !== "string" || !name.trim() || name === "None") return null;
  return { name: name.trim(), nodeId: String(node.id), nodeTitle: node.title || node.type, strength, source };
}

function scanCore(node) {
  if (!CORE_LORA_TYPES.has(node.type) && !CORE_LORA_TYPES.has(node.comfyClass)) return [];
  const name = widgetValue(node, ["lora_name", "lora"]);
  const strength = numeric(widgetValue(node, ["strength_model", "strength"]));
  const item = normalizedLora(name, node, strength, "core");
  return item && strength !== 0 ? [item] : [];
}

function scanWidgetLoader(node) {
  const type = `${node.type || ""} ${node.comfyClass || ""} ${node.title || ""}`.toLowerCase();
  if (!type.includes("lora") || !(type.includes("rgthree") || type.includes("power") || type.includes("manager") || type.includes("stack"))) return [];
  const result = [];
  const widgets = node.widgets || [];
  for (const widget of widgets) {
    const name = String(widget.name || "").toLowerCase();
    const value = widget.value;
    const isLoraWidget = name.includes("lora") || name.includes("model");
    if (type.includes("manager") && typeof value === "string") {
      const syntax = /<lora:([^:>]+):(-?(?:\d+(?:\.\d*)?|\.\d+))(?::[^>]*)?>/gi;
      for (const match of value.matchAll(syntax)) {
        const strength = numeric(match[2]);
        const item = normalizedLora(match[1], node, strength, "lora-manager");
        if (item && strength !== 0) result.push(item);
      }
    }
    if (!isLoraWidget) continue;
    if (typeof value === "string" && /\.(safetensors|pt|ckpt)$/i.test(value)) {
      const strengthWidget = widgets.find((candidate) => {
        const candidateName = String(candidate.name || "").toLowerCase();
        return candidateName.includes("strength") && candidateName.replace(/\D/g, "") === name.replace(/\D/g, "");
      });
      const strength = numeric(strengthWidget?.value);
      const item = normalizedLora(value, node, strength, type.includes("rgthree") || type.includes("power") ? "rgthree" : "lora-manager");
      if (item && strength !== 0) result.push(item);
    }
    if (value && typeof value === "object") {
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== "object") continue;
        const candidateName = candidate.lora || candidate.name || candidate.lora_name;
        const enabled = candidate.enabled ?? candidate.on ?? true;
        const strength = numeric(candidate.strength ?? candidate.strength_model ?? 1);
        const source = type.includes("rgthree") || type.includes("power") ? "rgthree" : "lora-manager";
        const item = normalizedLora(candidateName, node, strength, source);
        if (item && enabled && strength !== 0) result.push(item);
      }
    }
  }
  return result;
}

export function discoverActiveLoras(graph) {
  const found = [];
  for (const node of graph?._nodes || []) found.push(...scanCore(node), ...scanWidgetLoader(node));
  const unique = new Map();
  for (const item of found) unique.set(`${item.nodeId}:${item.name}`, item);
  return [...unique.values()];
}

export function discoverPromptTargets(graph) {
  const targets = [];
  for (const node of graph?._nodes || []) {
    const type = `${node.type || ""} ${node.comfyClass || ""} ${node.title || ""}`.toLowerCase();
    for (const widget of node.widgets || []) {
      if (typeof widget.value !== "string") continue;
      const widgetName = String(widget.name || "").toLowerCase();
      const isClipText = type.includes("cliptextencode") && (widgetName === "text" || widgetName.includes("prompt"));
      const isNamedPrompt = widgetName.includes("positive") || (type.includes("prompt") && widgetName === "text");
      if (isClipText || isNamedPrompt) {
        targets.push({ node, widget, id: `${node.id}:${widget.name}`, label: `${node.title || node.type} #${node.id} — ${widget.name}` });
      }
    }
  }
  return targets;
}

export function selectedTexts(profile, selections) {
  const texts = [];
  for (const group of profile.groups || []) {
    const selected = selections[group.id];
    const values = Array.isArray(selected) ? selected : selected ? [selected] : [];
    for (const text of values) {
      if (group.options.some((option) => option.text === text)) texts.push(text);
    }
  }
  return [...new Set(texts)];
}

function removeOwnedChunk(prompt, ownership) {
  if (!ownership?.chunk) return { prompt, start: prompt.length };
  const isExactOccurrence = (start) => {
    if (prompt.slice(start, start + ownership.chunk.length) !== ownership.chunk) return false;
    const remainder = prompt.slice(start + ownership.chunk.length);
    // The managed chunk was inserted as a complete prompt segment. A word or
    // same-line phrase immediately extending it means the user edited it.
    return remainder === "" || /^[,;]/.test(remainder) || /^[\r\n]/.test(remainder) || /^\s*$/.test(remainder);
  };
  const expectedStart = Number(ownership.start);
  if (Number.isInteger(expectedStart) && isExactOccurrence(expectedStart)) {
    return { prompt: prompt.slice(0, expectedStart) + prompt.slice(expectedStart + ownership.chunk.length), start: expectedStart };
  }
  const first = prompt.indexOf(ownership.chunk);
  if (first >= 0 && prompt.indexOf(ownership.chunk, first + 1) < 0 && isExactOccurrence(first)) {
    return { prompt: prompt.slice(0, first) + prompt.slice(first + ownership.chunk.length), start: first };
  }
  throw new Error("The managed text was edited manually. Restore it or use ‘Stop managing’ before syncing.");
}

export function buildPromptUpdate(currentPrompt, texts, ownership) {
  const removed = removeOwnedChunk(currentPrompt, ownership);
  if (!texts.length) return { value: removed.prompt, ownership: null };
  const managed = texts.join(", ");
  const trimmed = removed.prompt.trimEnd();
  const suffix = removed.prompt.slice(trimmed.length);
  const separator = trimmed ? (/[;,]$/.test(trimmed) ? " " : ", ") : "";
  const chunk = `${separator}${managed}`;
  const start = trimmed.length;
  return {
    value: `${trimmed}${chunk}${suffix}`,
    ownership: { chunk, start, managed, updatedAt: new Date().toISOString() },
  };
}

export function ensureExtensionState(graph) {
  graph.extra ||= {};
  graph.extra[EXTENSION_KEY] ||= { schemaVersion: 1, targetId: null, loras: {}, history: [] };
  const state = graph.extra[EXTENSION_KEY];
  state.loras ||= {};
  state.history ||= [];
  return state;
}

export function applyManagedUpdate(graph, target, ownerKey, texts) {
  const state = ensureExtensionState(graph);
  const owner = state.loras[ownerKey] || {};
  const beforeValue = target.widget.value;
  const beforeOwnership = owner.ownership ? structuredClone(owner.ownership) : null;
  const update = buildPromptUpdate(beforeValue, texts, owner.ownership);
  graph.beforeChange?.();
  target.widget.value = update.value;
  target.widget.callback?.(update.value, graph.canvas, target.node, target.widget);
  target.node.setDirtyCanvas?.(true, true);
  owner.ownership = update.ownership;
  owner.targetId = target.id;
  state.loras[ownerKey] = owner;
  state.targetId = target.id;
  state.history.push({ ownerKey, targetId: target.id, beforeValue, beforeOwnership, afterValue: update.value });
  if (state.history.length > 50) state.history.splice(0, state.history.length - 50);
  graph.afterChange?.();
  graph.setDirtyCanvas?.(true, true);
  return update.value;
}

export function undoManagedUpdate(graph) {
  const state = ensureExtensionState(graph);
  const entry = state.history.pop();
  if (!entry) throw new Error("There is no managed change to undo.");
  const target = discoverPromptTargets(graph).find((candidate) => candidate.id === entry.targetId);
  if (!target) throw new Error("The prompt field used by this change no longer exists.");
  if (target.widget.value !== entry.afterValue) {
    state.history.push(entry);
    throw new Error("The prompt changed after the last sync; exact undo was stopped to protect your edits.");
  }
  graph.beforeChange?.();
  target.widget.value = entry.beforeValue;
  target.widget.callback?.(entry.beforeValue, graph.canvas, target.node, target.widget);
  target.node.setDirtyCanvas?.(true, true);
  const owner = state.loras[entry.ownerKey] || {};
  owner.ownership = entry.beforeOwnership;
  state.loras[entry.ownerKey] = owner;
  graph.afterChange?.();
  graph.setDirtyCanvas?.(true, true);
  return entry.beforeValue;
}

export function stopManaging(graph, ownerKey) {
  const state = ensureExtensionState(graph);
  if (state.loras[ownerKey]) state.loras[ownerKey].ownership = null;
}
