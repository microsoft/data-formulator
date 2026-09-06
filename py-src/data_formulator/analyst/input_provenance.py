from __future__ import annotations

import json
from typing import Any

from data_formulator.analyst.workspace_inputs import WorkspaceInputManifest
from data_formulator.datalake.workspace_metadata import MemorySource


def normalize_input_sources(
    action: dict[str, Any],
    manifest: WorkspaceInputManifest | None,
) -> list[dict[str, str]]:
    """Resolve action provenance to exact run-manifest inputs."""
    by_id = {item.id: item for item in manifest.inputs} if manifest is not None else {}
    raw_sources = action.get("input_sources")
    if raw_sources is None:
        legacy_names = action.get("input_tables", [])
        if not isinstance(legacy_names, list):
            raise ValueError("input_tables must be an array")
        data_by_name = {
            item.display_name: item for item in manifest.data
        } if manifest is not None else {}
        normalized = []
        for raw_name in legacy_names:
            name = str(raw_name).strip()
            item = data_by_name.get(name)
            if manifest is not None and item is None:
                raise ValueError(f"Unknown legacy input table: {name}")
            normalized.append({
                "id": item.id if item is not None else name,
                "kind": "data",
                "display_name": item.display_name if item is not None else name,
            })
        return normalized

    if not isinstance(raw_sources, list):
        raise ValueError("input_sources must be an array")
    normalized = []
    seen: set[str] = set()
    for raw_source in raw_sources:
        if not isinstance(raw_source, dict):
            raise ValueError("Each input source must be an object")
        input_id = str(raw_source.get("id", "")).strip()
        kind = raw_source.get("kind")
        if not input_id or kind not in {"data", "file"}:
            raise ValueError("Each input source requires a valid id and kind")
        item = by_id.get(input_id)
        if manifest is not None and (item is None or item.kind != kind):
            raise ValueError(f"Unknown or mismatched input source: {input_id}")
        if input_id in seen:
            continue
        seen.add(input_id)
        normalized.append({
            "id": input_id,
            "kind": kind,
            "display_name": item.display_name if item is not None else input_id,
        })
    return normalized


def memory_sources(
    raw_sources: Any,
    manifest: WorkspaceInputManifest | None,
) -> list[MemorySource]:
    """Validate direct inputs and retain their transitive evidence lineage."""
    if not isinstance(raw_sources, list) or not raw_sources:
        raise ValueError("input_sources must be a non-empty array")
    by_id = {item.id: item for item in manifest.inputs} if manifest is not None else {}
    sources: list[MemorySource] = []
    seen: set[tuple[str, str]] = set()
    for raw_source in raw_sources:
        if not isinstance(raw_source, dict):
            raise ValueError("Each input source must be an object")
        input_id = str(raw_source.get("id", "")).strip()
        kind = raw_source.get("kind")
        item = by_id.get(input_id)
        if not input_id or kind not in {"data", "file"}:
            raise ValueError("Each input source requires a valid id and kind")
        if item is None or item.kind != kind:
            raise ValueError(f"Unknown or mismatched input source: {input_id}")

        inherited = item.sources if item.origin == "memory" and item.sources else ()
        candidates = [
            MemorySource(
                input_id=source.input_id or input_id,
                name=source.name,
                media_type=source.media_type,
                content_hash=source.content_hash,
                locator=source.locator,
            )
            for source in inherited
        ] or [MemorySource(
            input_id=item.id,
            name=item.display_name,
            media_type=item.media_type,
            content_hash=item.content_hash,
            locator=raw_source.get("locator"),
        )]
        for source in candidates:
            key = (source.input_id, json.dumps(source.locator, sort_keys=True))
            if key in seen:
                continue
            seen.add(key)
            sources.append(source)
    if not sources:
        raise ValueError("input_sources did not resolve to durable provenance")
    return sources