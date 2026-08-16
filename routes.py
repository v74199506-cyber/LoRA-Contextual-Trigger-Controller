"""ComfyUI HTTP routes. Imports are guarded so backend modules remain testable alone."""

from __future__ import annotations

import asyncio
from pathlib import Path

from .lctc.metadata import LoraMetadataService, MetadataError, fetch_civitai_by_hash
from .lctc.profiles import ProfileStore, ProfileValidationError

DATA_DIR = Path(__file__).resolve().parent / "data" / "profiles"
_registered = False


def register_routes() -> None:
    global _registered
    if _registered:
        return
    try:
        import folder_paths
        from aiohttp import web
        from server import PromptServer
    except ImportError:
        return

    service = LoraMetadataService(lambda name: folder_paths.get_full_path("loras", name))
    store = ProfileStore(DATA_DIR)
    routes = PromptServer.instance.routes

    def error_response(exc: Exception, status: int = 400):
        return web.json_response({"error": str(exc)}, status=status)

    @routes.get("/lctc/v1/lora")
    async def inspect_lora(request):
        try:
            result = await asyncio.to_thread(service.inspect, request.query.get("name", ""))
            result["profile"] = await asyncio.to_thread(store.load, result["fileHash"])
            return web.json_response(result)
        except (MetadataError, ProfileValidationError) as exc:
            return error_response(exc)
        except Exception:
            return error_response(RuntimeError("unexpected error while inspecting LoRA"), 500)

    @routes.get("/lctc/v1/profile/{file_hash}")
    async def get_profile(request):
        try:
            profile = await asyncio.to_thread(store.load, request.match_info["file_hash"])
            if profile is None:
                return error_response(FileNotFoundError("profile not found"), 404)
            return web.json_response(profile)
        except ProfileValidationError as exc:
            return error_response(exc)

    @routes.put("/lctc/v1/profile/{file_hash}")
    async def put_profile(request):
        try:
            if request.content_length is not None and request.content_length > 2 * 1024 * 1024:
                return error_response(ValueError("profile request is too large"), 413)
            profile = await request.json()
            saved = await asyncio.to_thread(store.save, profile, request.match_info["file_hash"])
            return web.json_response(saved)
        except (ProfileValidationError, ValueError) as exc:
            return error_response(exc)
        except Exception:
            return error_response(RuntimeError("unexpected error while saving profile"), 500)

    @routes.post("/lctc/v1/civitai/{file_hash}")
    async def civitai_lookup(request):
        # Calling this POST route is the user's explicit opt-in for this one lookup.
        try:
            result = await asyncio.to_thread(fetch_civitai_by_hash, request.match_info["file_hash"])
            return web.json_response(result)
        except MetadataError as exc:
            return error_response(exc, 502)

    _registered = True
