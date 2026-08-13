# Proposed Architecture

## Components

```text
Python backend
  ├─ SafeTensors header reader
  ├─ LoRA path and hash resolver
  ├─ local profile/cache store
  ├─ optional Civitai metadata client
  └─ ComfyUI HTTP endpoints

Browser extension
  ├─ loader adapters
  ├─ positive-prompt target resolver
  ├─ contextual side panel
  ├─ trigger group editor
  ├─ managed prompt synchronizer
  └─ undo/history state

Shared profile model
  ├─ LoRA identity and architecture
  ├─ trigger provenance
  ├─ semantic groups
  ├─ exclusivity rules
  └─ current selections
```

## Profile draft

```json
{
  "schemaVersion": 1,
  "fileHash": "sha256",
  "displayName": "Example LoRA",
  "baseModel": "Illustrious",
  "sources": ["publisher", "embedded", "user"],
  "groups": [
    {
      "id": "activation",
      "label": "Activation",
      "exclusive": false,
      "required": false,
      "options": [
        { "label": "Base trigger", "text": "base_trigger" }
      ]
    },
    {
      "id": "position",
      "label": "Position",
      "exclusive": true,
      "required": false,
      "options": [
        { "label": "Standing", "text": "standing_trigger" },
        { "label": "Sitting", "text": "sitting_trigger" }
      ]
    }
  ]
}
```

## Prompt synchronization

The preferred implementation stores managed trigger state separately in the
workflow's extension data. It then performs a conservative diff against the
selected prompt widget:

1. Remember triggers previously inserted by this LoRA profile.
2. Remove only exact managed occurrences that still exist.
3. Insert the new selections at a stable user-configurable location.
4. Preserve surrounding whitespace, paragraph organization, weights, LoRA tags,
   wildcards, embeddings, and unrelated text.
5. Push the exact prior widget value into undo history.

If the user manually edits a managed trigger, the extension should detect the
divergence and ask whether to adopt the manual value or stop managing it.

## Initial loader adapters

- Core `LoraLoader` / `LoraLoaderModelOnly` where relevant.
- rgthree Power LoRA Loader.
- ComfyUI LoRA Manager loaders and stacks.

Adapters should expose a normalized stream of active LoRAs rather than coupling
the controller to each loader's internal UI.

