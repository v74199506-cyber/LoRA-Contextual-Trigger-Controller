# Roadmap

## Phase 0 — research fixtures

- Capture representative metadata fixtures for pose, character, clothing,
  camera, expression, style, slider, and utility LoRAs.
- Document how core, rgthree, and LoRA Manager nodes serialize selected LoRAs.
- Define the profile schema and migration rules.

## Phase 1 — local MVP

- Detect one active LoRA from a supported loader.
- Read SafeTensors header metadata without loading model tensors.
- Allow creation and editing of a manual trigger profile.
- Show a contextual panel with checkbox and exclusive radio groups.
- Select one editable positive prompt as the target.
- Insert, replace, remove, and undo managed trigger text safely.
- Persist profile data by SHA-256 hash.

## Phase 2 — metadata assistance

- Add opt-in Civitai lookup by hash.
- Import publisher `trainedWords` and description text.
- Extract explicitly headed sections such as Positions and Angles/Camera.
- Propose groups using conservative vocabulary rules.
- Show provenance and confidence for every proposed option.

## Phase 3 — multiple LoRAs

- Track multiple active LoRAs and separate ownership of inserted triggers.
- Detect conflicts across profiles without deleting them automatically.
- Support loader stacks, toggled LoRAs, and target-prompt selection.
- Add import/export of portable profile JSON files.

## Phase 4 — release readiness

- Tests for parsing, synchronization, undo, migration, and unsafe HTML handling.
- Compatibility tests against current ComfyUI frontend releases.
- Clear privacy controls and offline behavior.
- README screenshots, installation instructions, changelog, MIT license, package
  metadata, and Comfy Registry publishing configuration.

## MVP acceptance criteria

Using a pose LoRA with four position triggers and several camera triggers, a user
can select `Standing`, change it to `Sitting`, and observe only the managed pose
word change in the chosen positive prompt. Camera selection and unrelated prompt
text remain untouched, and Undo restores the exact previous prompt.

