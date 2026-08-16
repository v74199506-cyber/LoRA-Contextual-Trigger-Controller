"""SafeTensors metadata, file identity, and optional public metadata lookup."""

from __future__ import annotations

import hashlib
import json
import struct
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

MAX_HEADER_BYTES = 16 * 1024 * 1024
MAX_CIVITAI_BYTES = 4 * 1024 * 1024


class MetadataError(ValueError):
    pass


def sha256_file(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def read_safetensors_metadata(path: Path) -> dict[str, Any]:
    """Read only the bounded JSON header; tensor data is never loaded."""
    try:
        file_size = path.stat().st_size
        with path.open("rb") as stream:
            raw_length = stream.read(8)
            if len(raw_length) != 8:
                raise MetadataError("file is too small to be a SafeTensors file")
            (header_length,) = struct.unpack("<Q", raw_length)
            if header_length <= 2 or header_length > MAX_HEADER_BYTES:
                raise MetadataError("SafeTensors header size is invalid or exceeds the safety limit")
            if 8 + header_length > file_size:
                raise MetadataError("SafeTensors header extends beyond the file")
            header = json.loads(stream.read(header_length).decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, struct.error) as exc:
        raise MetadataError(f"could not read SafeTensors metadata: {exc}") from exc
    if not isinstance(header, dict):
        raise MetadataError("SafeTensors header must be a JSON object")
    metadata = header.get("__metadata__", {})
    return metadata if isinstance(metadata, dict) else {}


def _json_value(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped or stripped[0] not in "[{":
        return value
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return value


def summarize_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    """Expose useful, bounded metadata without sending tensor descriptors."""
    result: dict[str, Any] = {}
    for key, value in metadata.items():
        if not isinstance(key, str) or len(key) > 256:
            continue
        decoded = _json_value(value)
        # Training tag maps may be large. Keep enough for review without freezing the UI.
        if isinstance(decoded, dict) and len(decoded) > 1000:
            decoded = dict(list(decoded.items())[:1000])
        if isinstance(decoded, str) and len(decoded) > 100_000:
            decoded = decoded[:100_000]
        result[key] = decoded
    return result


def infer_base_model(metadata: dict[str, Any]) -> str:
    haystack = " ".join(
        str(metadata.get(key, ""))
        for key in ("ss_base_model_version", "modelspec.architecture", "modelspec.title")
    ).lower()
    for needle, label in (
        ("illustrious", "Illustrious"),
        ("pony", "Pony"),
        ("flux", "Flux"),
        ("sdxl", "SDXL"),
        ("stable-diffusion-xl", "SDXL"),
        ("sd_v1", "SD 1.x"),
        ("stable-diffusion-v1", "SD 1.x"),
    ):
        if needle in haystack:
            return label
    return "Unknown"


class LoraMetadataService:
    def __init__(self, resolve_lora: Callable[[str], str | None]):
        self.resolve_lora = resolve_lora

    def resolve(self, name: str) -> Path:
        if not isinstance(name, str) or not name.strip() or len(name) > 1024:
            raise MetadataError("invalid LoRA name")
        resolved = self.resolve_lora(name)
        if not resolved and not name.lower().endswith(".safetensors"):
            resolved = self.resolve_lora(f"{name}.safetensors")
        if not resolved:
            raise MetadataError("LoRA was not found in ComfyUI's configured loras folders")
        path = Path(resolved).resolve()
        if not path.is_file():
            raise MetadataError("resolved LoRA is not a file")
        if path.suffix.lower() != ".safetensors":
            raise MetadataError("only .safetensors LoRAs are supported by the MVP")
        return path

    def inspect(self, name: str) -> dict[str, Any]:
        path = self.resolve(name)
        metadata = summarize_metadata(read_safetensors_metadata(path))
        return {
            "name": name,
            "displayName": path.stem,
            "fileHash": sha256_file(path),
            "size": path.stat().st_size,
            "baseModel": infer_base_model(metadata),
            "metadata": metadata,
        }


def fetch_civitai_by_hash(file_hash: str, timeout: float = 10.0) -> dict[str, Any]:
    """Fetch public model-version metadata. Only the SHA-256 appears in the request."""
    if len(file_hash) != 64 or any(c not in "0123456789abcdef" for c in file_hash.lower()):
        raise MetadataError("invalid SHA-256 hash")
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{file_hash.lower()}"
    request = urllib.request.Request(url, headers={"User-Agent": "LoRA-Contextual-Trigger-Controller/0.1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise MetadataError(f"Civitai returned HTTP {response.status}")
            payload = response.read(MAX_CIVITAI_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise MetadataError(f"Civitai lookup failed: {exc}") from exc
    if len(payload) > MAX_CIVITAI_BYTES:
        raise MetadataError("Civitai response exceeded the safety limit")
    try:
        data = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MetadataError("Civitai returned invalid JSON") from exc
    if not isinstance(data, dict):
        raise MetadataError("Civitai returned an unexpected response")
    # Description remains plain text. The frontend never assigns it to innerHTML.
    return {
        "id": data.get("id"),
        "name": data.get("name"),
        "baseModel": data.get("baseModel"),
        "trainedWords": data.get("trainedWords") if isinstance(data.get("trainedWords"), list) else [],
        "description": data.get("description") if isinstance(data.get("description"), str) else "",
        "model": {"id": (data.get("model") or {}).get("id"), "name": (data.get("model") or {}).get("name")}
        if isinstance(data.get("model"), dict)
        else None,
    }
