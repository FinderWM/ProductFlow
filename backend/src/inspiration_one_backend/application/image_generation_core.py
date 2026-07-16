from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from inspiration_one_backend.application.contracts import ReferenceImageInput
from inspiration_one_backend.config import filter_image_tool_options
from inspiration_one_backend.infrastructure.image.base import image_dimensions_from_bytes
from inspiration_one_backend.infrastructure.storage import StorageService


class StoredImageReference(Protocol):
    id: str
    storage_path: str
    storage_object_key: str | None
    mime_type: str
    original_filename: str


@dataclass(frozen=True, slots=True)
class ImageGenerationReferencePayload:
    source_image: ReferenceImageInput | None
    reference_images: list[ReferenceImageInput]


def unique_image_generation_ids(ids: list[str] | None) -> list[str]:
    seen: set[str] = set()
    values: list[str] = []
    for item in ids or []:
        if item in seen:
            continue
        seen.add(item)
        values.append(item)
    return values


def normalize_image_generation_tool_options(tool_options: dict[str, Any] | None) -> dict[str, Any] | None:
    normalized = filter_image_tool_options(tool_options)
    if not normalized:
        return None
    normalized.pop("n", None)
    return normalized or None


def unique_image_generation_references[T: StoredImageReference](references: list[T]) -> list[T]:
    unique_by_path: dict[str, T] = {}
    for reference in references:
        unique_by_path.setdefault(_storage_key(reference), reference)
    return list(unique_by_path.values())


def build_stored_image_reference_payload(
    references: list[StoredImageReference],
    *,
    storage: StorageService,
    max_bytes: int,
) -> ImageGenerationReferencePayload:
    unique_references = unique_image_generation_references(references)
    reference_inputs = [
        ReferenceImageInput(
            bytes_data=storage.read_bytes(_storage_key(reference), max_bytes=max_bytes),
            mime_type=reference.mime_type,
            filename=reference.original_filename,
            source_key=_storage_key(reference),
        )
        for reference in unique_references
    ]
    return ImageGenerationReferencePayload(
        source_image=reference_inputs[0] if reference_inputs else None,
        reference_images=reference_inputs,
    )


def _storage_key(reference: StoredImageReference) -> str:
    return getattr(reference, "storage_object_key", None) or reference.storage_path


def provider_output_with_actual_image_size(
    provider_output_json: dict[str, Any] | None,
    *,
    requested_size: str,
    image_bytes: bytes,
) -> dict[str, Any]:
    output = dict(provider_output_json or {})
    dimensions = image_dimensions_from_bytes(image_bytes)
    if dimensions is None:
        return output

    actual_size = f"{dimensions[0]}x{dimensions[1]}"
    metadata = output.get("_inspiration_one")
    metadata = dict(metadata) if isinstance(metadata, dict) else {}
    metadata["actual_image_size"] = actual_size
    if actual_size != requested_size:
        raw_notes = metadata.get("notes")
        notes = [note for note in raw_notes if isinstance(note, dict)] if isinstance(raw_notes, list) else []
        if not any(note.get("kind") == "actual_size_mismatch" for note in notes):
            notes.append(
                {
                    "kind": "actual_size_mismatch",
                    "message": f"供应商实际返回 {actual_size}，请求尺寸为 {requested_size}。",
                    "requested_size": requested_size,
                    "actual_size": actual_size,
                }
            )
        metadata["notes"] = notes
    output["_inspiration_one"] = metadata
    return output
