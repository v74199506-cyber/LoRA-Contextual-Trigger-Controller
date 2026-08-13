# Product Decisions

## Extension, not mandatory workflow node

The main experience should be an always-available ComfyUI frontend extension.
Optional nodes may be considered later for workflows that need a `STRING`
output, but the primary feature must not require rewiring a graph.

## Managed prompt region

The extension must never scan the whole prompt and delete every occurrence of a
word merely because it resembles a trigger. Each LoRA owns a small managed state
containing the triggers inserted through its controller.

When a user changes a selection, only the previous trigger owned by the same
group and LoRA is replaced.

## Visual chips are not prompt syntax

Labels such as `[Position: Standing]` belong to the interface. Literal square
brackets are not added to the encoded prompt because prompt parsers may interpret
them as weighting syntax.

## Trigger sources and precedence

Use sources in this order while retaining provenance:

1. User-confirmed local profile.
2. Explicit trigger words declared by the model publisher.
3. Structured sections extracted from publisher documentation.
4. Embedded SafeTensors training metadata.
5. Conservative filename and vocabulary heuristics.

Frequency-heavy training tags are evidence, not proof that every tag is an
activation trigger.

## Classification confidence

- High-confidence structural matches may be proposed automatically.
- Ambiguous groups require user confirmation.
- The user can move, rename, add, remove, or mark options as non-exclusive.
- Confirmed profiles are cached by file hash so renaming the file does not lose
  the configuration.

## Online behavior

- Civitai integration is optional.
- Descriptions are treated as untrusted data and rendered as text, not executable
  HTML.
- Prompts, workflows, images, API keys, and unrelated local file data are never
  transmitted.
- Network failures must not prevent use of saved local profiles.

## Relationship with Prompt Redundancy Assistant

This is a separate project. Future interoperability is welcome—for example,
sharing contradiction warnings—but neither extension should require the other.

