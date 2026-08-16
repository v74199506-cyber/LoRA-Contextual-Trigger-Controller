import test from "node:test";
import assert from "node:assert/strict";
import { applyManagedUpdate, buildPromptUpdate, classifyTrigger, discoverActiveLoras, inferLoraCategory, undoManagedUpdate } from "../web/lctc-core.js";

test("replaces only owned triggers and preserves unrelated text", () => {
  const first = buildPromptUpdate("portrait, dramatic light", ["standing", "from above"], null);
  assert.equal(first.value, "portrait, dramatic light, standing, from above");
  const second = buildPromptUpdate(first.value, ["sitting", "from above"], first.ownership);
  assert.equal(second.value, "portrait, dramatic light, sitting, from above");
});

test("preserves trailing whitespace exactly", () => {
  const update = buildPromptUpdate("portrait\n\n", ["standing"], null);
  assert.equal(update.value, "portrait, standing\n\n");
  assert.equal(buildPromptUpdate(update.value, [], update.ownership).value, "portrait\n\n");
});

test("finds shifted owned chunk after unrelated manual prefix edit", () => {
  const first = buildPromptUpdate("portrait", ["standing"], null);
  const second = buildPromptUpdate(`masterpiece, ${first.value}`, ["sitting"], first.ownership);
  assert.equal(second.value, "masterpiece, portrait, sitting");
});

test("refuses altered or ambiguous managed text", () => {
  const first = buildPromptUpdate("portrait", ["standing"], null);
  assert.throws(() => buildPromptUpdate(first.value.replace("standing", "standing tall"), ["sitting"], first.ownership), /edited manually/);
  assert.throws(() => buildPromptUpdate(`${first.value}${first.ownership.chunk}`, ["sitting"], { ...first.ownership, start: 999 }), /edited manually/);
});

test("exact undo restores the entire prior widget value", () => {
  const widget = { name: "text", value: "portrait\n" };
  const node = { id: 7, type: "CLIPTextEncode", widgets: [widget] };
  const graph = { _nodes: [node], extra: {}, beforeChange() {}, afterChange() {}, setDirtyCanvas() {} };
  applyManagedUpdate(graph, { node, widget, id: "7:text" }, "hash:1", ["standing"]);
  assert.equal(widget.value, "portrait, standing\n");
  undoManagedUpdate(graph);
  assert.equal(widget.value, "portrait\n");
});

test("undo refuses to overwrite subsequent user edits", () => {
  const widget = { name: "text", value: "portrait" };
  const node = { id: 7, type: "CLIPTextEncode", widgets: [widget] };
  const graph = { _nodes: [node], extra: {}, beforeChange() {}, afterChange() {} };
  applyManagedUpdate(graph, { node, widget, id: "7:text" }, "hash:1", ["standing"]);
  widget.value += ", smile";
  assert.throws(() => undoManagedUpdate(graph), /changed/);
});

test("detects core loaders and ignores zero strength", () => {
  const graph = { _nodes: [
    { id: 1, type: "LoraLoader", widgets: [{ name: "lora_name", value: "pose.safetensors" }, { name: "strength_model", value: 0.8 }] },
    { id: 2, type: "LoraLoader", widgets: [{ name: "lora_name", value: "off.safetensors" }, { name: "strength_model", value: 0 }] },
  ] };
  assert.deepEqual(discoverActiveLoras(graph).map((item) => item.name), ["pose.safetensors"]);
});

test("detects rgthree object widgets and LoRA Manager text syntax", () => {
  const graph = { _nodes: [
    { id: 3, type: "Power Lora Loader (rgthree)", widgets: [{ name: "lora_1", value: { on: true, lora: "camera.safetensors", strength: 0.7 } }, { name: "lora_2", value: { on: false, lora: "off.safetensors", strength: 1 } }] },
    { id: 4, type: "Lora Loader (LoraManager)", widgets: [{ name: "text", value: "<lora:poses/character:0.8>" }] },
  ] };
  assert.deepEqual(discoverActiveLoras(graph).map((item) => [item.name, item.source]), [
    ["camera.safetensors", "rgthree"],
    ["poses/character", "lora-manager"],
  ]);
});

test("classifies only conservative contextual vocabulary", () => {
  assert.deepEqual(classifyTrigger("pose_standing_trigger").id, "position");
  assert.deepEqual(classifyTrigger("dramatic_from_above").id, "camera-angle");
  assert.deepEqual(classifyTrigger("character_token_xyz").id, "unclassified");
  assert.equal(classifyTrigger("blue_dress").exclusive, false);
});

test("infers broad LoRA categories without claiming confirmation", () => {
  assert.equal(inferLoraCategory("Intercrural_Poses_Standing_Lying.safetensors"), "Pose");
  assert.equal(inferLoraCategory("cinematic_lighting_control.safetensors"), "Lighting");
  assert.equal(inferLoraCategory("blue_dress_outfit.safetensors"), "Clothing");
  assert.equal(inferLoraCategory("Dungeon_Squad_IllustriousV5.safetensors"), "Unknown");
});
