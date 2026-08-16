"""Profile validation and atomic local persistence."""

from __future__ import annotations

import json
import os
import re
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any

HASH_RE = re.compile(r"^[0-9a-f]{64}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")
MAX_GROUPS = 100
MAX_OPTIONS = 500
MAX_TEXT = 2048
LORA_CATEGORIES = {
    "Unknown", "Character", "Pose", "Clothing", "Style", "Lighting",
    "Camera", "Expression", "Slider", "Utility", "Concept",
}


class ProfileValidationError(ValueError):
    pass


def _text(value: Any, field: str, *, limit: int = MAX_TEXT, required: bool = True) -> str:
    if not isinstance(value, str):
        raise ProfileValidationError(f"{field} must be a string")
    value = value.strip()
    if required and not value:
        raise ProfileValidationError(f"{field} cannot be empty")
    if len(value) > limit:
        raise ProfileValidationError(f"{field} exceeds {limit} characters")
    return value


def validate_profile(profile: Any, expected_hash: str | None = None) -> dict[str, Any]:
    """Return a normalized profile or raise a user-safe validation error."""
    if not isinstance(profile, dict):
        raise ProfileValidationError("profile must be an object")
    data = deepcopy(profile)
    if data.get("schemaVersion") != 1:
        raise ProfileValidationError("only schemaVersion 1 is supported")

    file_hash = _text(data.get("fileHash"), "fileHash", limit=64).lower()
    if not HASH_RE.fullmatch(file_hash):
        raise ProfileValidationError("fileHash must be a lowercase SHA-256 digest")
    if expected_hash and file_hash != expected_hash.lower():
        raise ProfileValidationError("profile hash does not match the requested LoRA")

    data["fileHash"] = file_hash
    data["displayName"] = _text(data.get("displayName"), "displayName", limit=256)
    data["baseModel"] = _text(data.get("baseModel", "Unknown"), "baseModel", limit=128)
    category = _text(data.get("category", "Unknown"), "category", limit=64)
    if category not in LORA_CATEGORIES:
        raise ProfileValidationError(f"unsupported LoRA category: {category}")
    data["category"] = category
    data["categoryConfirmed"] = bool(data.get("categoryConfirmed", False))

    sources = data.get("sources", ["user"])
    if not isinstance(sources, list) or len(sources) > 20:
        raise ProfileValidationError("sources must be a list with at most 20 items")
    data["sources"] = list(dict.fromkeys(_text(v, "source", limit=64) for v in sources))

    groups = data.get("groups")
    if not isinstance(groups, list) or len(groups) > MAX_GROUPS:
        raise ProfileValidationError(f"groups must be a list with at most {MAX_GROUPS} items")

    group_ids: set[str] = set()
    option_count = 0
    normalized_groups = []
    for group_index, group in enumerate(groups):
        if not isinstance(group, dict):
            raise ProfileValidationError(f"groups[{group_index}] must be an object")
        group_id = _text(group.get("id"), f"groups[{group_index}].id", limit=64)
        if not ID_RE.fullmatch(group_id) or group_id in group_ids:
            raise ProfileValidationError(f"invalid or duplicate group id: {group_id}")
        group_ids.add(group_id)
        options = group.get("options")
        if not isinstance(options, list):
            raise ProfileValidationError(f"group {group_id} options must be a list")
        option_count += len(options)
        if option_count > MAX_OPTIONS:
            raise ProfileValidationError(f"profile exceeds {MAX_OPTIONS} options")

        normalized_options = []
        seen_text: set[str] = set()
        for option_index, option in enumerate(options):
            if not isinstance(option, dict):
                raise ProfileValidationError(f"option {option_index} in {group_id} must be an object")
            text = _text(option.get("text"), f"option {option_index} text")
            if text in seen_text:
                raise ProfileValidationError(f"duplicate option text in {group_id}: {text}")
            seen_text.add(text)
            normalized = {
                "label": _text(option.get("label"), f"option {option_index} label", limit=256),
                "text": text,
            }
            if "provenance" in option:
                normalized["provenance"] = _text(option["provenance"], "provenance", limit=64)
            if "confidence" in option:
                confidence = option["confidence"]
                if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
                    raise ProfileValidationError("confidence must be between 0 and 1")
                normalized["confidence"] = float(confidence)
            normalized_options.append(normalized)

        required = bool(group.get("required", False))
        if required and not normalized_options:
            raise ProfileValidationError(f"required group {group_id} has no options")
        normalized_groups.append(
            {
                "id": group_id,
                "label": _text(group.get("label"), f"groups[{group_index}].label", limit=256),
                "exclusive": bool(group.get("exclusive", False)),
                "required": required,
                "options": normalized_options,
            }
        )
    data["groups"] = normalized_groups
    return data


class ProfileStore:
    def __init__(self, root: Path):
        self.root = root

    def _path(self, file_hash: str) -> Path:
        digest = file_hash.lower()
        if not HASH_RE.fullmatch(digest):
            raise ProfileValidationError("invalid SHA-256 hash")
        return self.root / f"{digest}.json"

    def load(self, file_hash: str) -> dict[str, Any] | None:
        path = self._path(file_hash)
        if not path.exists():
            return None
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ProfileValidationError(f"saved profile is unreadable: {exc}") from exc
        return validate_profile(raw, file_hash)

    def save(self, profile: Any, expected_hash: str | None = None) -> dict[str, Any]:
        data = validate_profile(profile, expected_hash)
        self.root.mkdir(parents=True, exist_ok=True)
        target = self._path(data["fileHash"])
        handle, temporary = tempfile.mkstemp(prefix=".lctc-", suffix=".json", dir=self.root)
        try:
            with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, target)
        except Exception:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise
        return data
