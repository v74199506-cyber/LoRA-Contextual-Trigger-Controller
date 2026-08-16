# LoRA Contextual Trigger Controller

An upcoming ComfyUI extension that turns LoRA documentation and trigger words
into contextual controls for the positive prompt.

## Vision

Selecting a LoRA should reveal the choices it actually supports. Instead of
copying a long, unordered list of trained words, the user receives understandable
controls such as position, camera angle, distance, orientation, expression,
outfit, or style.

Changing a mutually exclusive choice replaces the previous managed trigger
instead of accumulating contradictions in the prompt.

Example:

```text
LoRA: Example Pose Controller

Activation
[x] base_trigger

Position
( ) Lying
(x) Standing
( ) Sitting

Camera angle
( ) Automatic
(x) From above
( ) From below
```

The visible controls correspond to ordinary prompt text:

```text
base_trigger, standing_trigger, from_above_trigger
```

## Core behavior

1. Detect LoRAs selected in supported ComfyUI loaders.
2. Read local SafeTensors metadata and cached companion metadata.
3. Optionally query Civitai by model hash for public trained words and
   documentation.
4. Propose semantic trigger groups such as activation, pose, camera, POV,
   expression, outfit, and style.
5. Ask the user to confirm uncertain classifications before saving them.
6. Present contextual controls beside the selected LoRA or prompt.
7. Synchronize managed triggers with a chosen positive prompt field.
8. Replace mutually exclusive alternatives without deleting user-authored text.
9. Preserve exact undo and store the confirmed profile locally.

## Differentiation

Existing tools already provide important pieces:

- ComfyUI LoRA Manager fetches metadata and offers a TriggerWord Toggle node.
- ComfyUI-Lora-Auto-Trigger-Words fetches tags and selects them by index.
- CrasHUtils exposes individually toggleable trigger tags from companion files.
- Standard Trigger Words provides manually curated categories.
- Workflow Studio can append trained words to positive prompts.

This project is specifically about combining four behaviors that are not
currently available together:

- contextual interpretation of each selected LoRA;
- automatic but reviewable grouping of its trigger alternatives;
- mutually exclusive selections such as standing versus lying;
- direct, reversible synchronization with an existing editable prompt.

## Design principles

- **Local first:** local metadata and cached profiles work without internet.
- **Optional network access:** Civitai lookup is opt-in and sends only the
  identifier required to resolve public model metadata.
- **Review before trust:** inferred categories are suggestions until confirmed.
- **Non-destructive:** only text explicitly managed by this extension is replaced.
- **No hidden prompt syntax:** UI chips are visual controls; the CLIP prompt
  receives normal trigger words.
- **Loader-agnostic direction:** begin with core Load LoRA, rgthree Power LoRA
  Loader, and LoRA Manager, then add adapters for other loaders.
- **Architecture-aware:** surface SD1.5, SDXL, Pony, Illustrious, Flux, and other
  compatibility metadata without claiming certainty when metadata is incomplete.
- **Adult-content neutral:** trigger metadata is handled as technical text; the
  extension neither generates nor uploads images.

## Current MVP

An installable local MVP is now implemented. It provides:

- a frontend side panel that detects core `LoraLoader` nodes, rgthree Power LoRA
  Loader widgets, and LoRA Manager loader data;
- bounded SafeTensors header reading and SHA-256 identity without loading tensors;
- local, atomic profile persistence under `data/profiles/`;
- manual semantic group and option editing, including exclusive radio groups;
- explicit positive-prompt target selection;
- conservative managed-text replacement with workflow-owned state and exact undo;
- conservative, reviewable grouping and broad LoRA type classification;
- active-LoRA status indicators and explicitly confirmed local categories;
- opt-in Civitai lookup that sends only the selected file's SHA-256 hash.

Tags imported from metadata or Civitai are deliberately shown as unselected
suggestions for human review. More advanced extraction from free-form publisher
documentation remains a later metadata-assistance phase.

## Install for local testing

Place this repository directory inside `ComfyUI/custom_nodes/` and restart
ComfyUI. No Python package installation is required. After refreshing the
browser, use the **LoRA Triggers** button at the lower-right corner.

Profiles are private local files and are ignored by Git. Civitai is never queried
unless the user confirms a lookup in the panel.

## Test

```powershell
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/*.test.js
```

No workflow node is added: this is intentionally a frontend-first extension.

See [ARCHITECTURE.md](ARCHITECTURE.md), [DECISIONS.md](DECISIONS.md), and
[ROADMAP.md](ROADMAP.md).
