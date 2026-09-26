from __future__ import annotations

import logging
import json
import hashlib
from pathlib import PurePosixPath
from urllib.parse import urlsplit, quote
from datetime import datetime, timezone
from dataclasses import dataclass
from typing import Callable

import pyarrow as pa
from data_formulator.data_loader.query_runtime import check_cancelled, execute_source_query

from data_formulator.datalake.parquet_utils import sanitize_table_name
from data_formulator.data_loader.external_data_loader import (
    ExternalDataLoader,
    _merge_source_metadata,
    apply_import_projection,
)

from .models import (
    ConnectorQueryStep,
    DataOperation,
    DataOperationStatus,
    FailedOperationStep,
    OperationError,
    LoadQuery,
)


logger = logging.getLogger(__name__)
MAX_AGGREGATE_ROWS = 10_000


LoaderResolver = Callable[[str], ExternalDataLoader]


def execute_aggregate_query(loader, source_table: str, query: LoadQuery) -> pa.Table:
    if query.native is not None and query.native["language"] not in loader.query_capabilities().get("native_query_languages", []):
        raise ValueError("Native query language is not supported by this connector.")
    if query.limit is not None and query.limit > MAX_AGGREGATE_ROWS:
        raise ValueError(f"Aggregate result limit must not exceed {MAX_AGGREGATE_ROWS}")
    result_limit = query.limit or MAX_AGGREGATE_ROWS
    table = execute_source_query(
        loader, "query_data_as_arrow", source_table=source_table,
        query=query.to_dict(), limit=result_limit + 1,
    )
    if not isinstance(table, pa.Table):
        raise TypeError("Connector query must return pyarrow.Table")
    if table.num_rows > result_limit and query.limit is None:
        raise ValueError("Query result exceeds 10000 rows. Narrow the query or request an explicit result limit.")
    return table.slice(0, result_limit)


@dataclass(frozen=True)
class DataOperationExecutionResult:
    result_table_ids: tuple[str, ...]
    failed_steps: tuple[FailedOperationStep, ...] = ()
    result_references: tuple[dict, ...] = ()


class DataOperationExecutor:
    def __init__(
        self,
        workspace,
        loader_resolver: LoaderResolver | None = None,
        *,
        external_references: list[dict] | None = None,
    ):
        self._workspace = workspace
        self._loader_resolver = loader_resolver or self._resolve_live_loader
        self._external_references = external_references or []

    def execute(self, operation: DataOperation) -> DataOperationExecutionResult:
        if operation.status != DataOperationStatus.RUNNING:
            raise ValueError(f"Data operation is not running: {operation.id}")
        if operation.selected_plan_id is None:
            raise ValueError("Running data operation requires selected_plan_id")
        plan = next(
            item for item in operation.plans
            if item.id == operation.selected_plan_id
        )

        published = self._find_published_results(operation.id, plan.plan_hash)
        used_names = set(self._workspace.list_tables())
        result_table_ids: list[str] = []
        result_references: list[dict] = []
        known_sources = {(item.get("connectorId"), item.get("tableKey")) for item in self._external_references}
        for name in used_names:
            metadata = self._workspace.get_table_metadata(name)
            provenance = (metadata.import_options or {}).get("data_operation", {}) if metadata else {}
            if provenance.get("operation_id") != operation.id:
                known_sources.add((provenance.get("source_id"), provenance.get("table_key")))
                origin = metadata.imported_from or {} if metadata else {}
                known_sources.add((origin.get("source_id"), origin.get("table_key")))
        failed_steps: list[FailedOperationStep] = []
        for step_index, step in enumerate(plan.steps):
            check_cancelled()
            table_name = self._allocate_table_name(self._requested_table_name(step), used_names)
            used_names.add(table_name)
            try:
                concrete_query = bool(step.materialize or step.query.to_dict())
                source_key = (step.source_id, step.table_key)
                reference = None if concrete_query and source_key in known_sources else self._virtual_reference(step)
                if reference is not None:
                    if source_key not in known_sources:
                        result_references.append(reference)
                        known_sources.add(source_key)
                    if not concrete_query:
                        if not any(item["id"] == reference["id"] for item in result_references):
                            existing = next((item for item in self._external_references if item.get("id") == reference["id"]), reference)
                            result_references.append(existing)
                        continue
                if step_index in published:
                    result_table_ids.append(published[step_index])
                    continue
                result_table_ids.append(self._publish_connector_query(
                    table_name,
                    step,
                    operation_id=operation.id,
                    plan_hash=plan.plan_hash,
                    step_index=step_index,
                ))
            except Exception as exc:
                logger.exception(
                    "Data operation %s failed to load step %d (%s)",
                    operation.id,
                    step_index,
                    step.display_name,
                )
                failed_steps.append(FailedOperationStep(
                    step_index=step_index,
                    display_name=step.display_name,
                    error=OperationError(
                        code="connector_error",
                        message=(str(exc) if isinstance(exc, (ValueError, NotImplementedError))
                                 else f"{step.display_name} could not be loaded."),
                    ),
                ))
        for reference in result_references:
            for table_id in result_table_ids:
                metadata = self._workspace.get_table_metadata(table_id)
                provenance = (metadata.import_options or {}).get("data_operation", {})
                if (provenance.get("source_id"), provenance.get("table_key")) == (reference["connectorId"], reference["tableKey"]):
                    reference["capturedAt"] = metadata.created_at.isoformat()
                    break
        return DataOperationExecutionResult(
            tuple(result_table_ids),
            tuple(failed_steps),
            tuple(result_references),
        )

    def _virtual_reference(self, step: ConnectorQueryStep) -> dict | None:
        concrete_query = bool(step.materialize or step.query.to_dict())
        from data_formulator.configuration import effective_limit
        from .discovery import DataDiscoveryService

        resolved = DataDiscoveryService(self._workspace).resolve_load_table(step.source_id, step.table_key)
        metadata = (resolved or {}).get("metadata") or {}
        sizes = {}
        for key in ("row_count", "original_size_bytes", "size_bytes", "file_size"):
            try:
                value = float(metadata.get(key))
                if value >= 0 and value < float("inf"):
                    sizes[key] = value
            except (TypeError, ValueError):
                pass
        if not concrete_query and not (sizes.get("row_count", 0) > effective_limit("external_table_max_rows")
                or any(sizes.get(key, 0) > effective_limit("external_table_max_bytes")
                       for key in ("original_size_bytes", "size_bytes", "file_size"))):
            return None
        safe = "~()*!.'-"
        return {
            "kind": "external-table-reference",
            "id": f"external:{quote(step.source_id, safe=safe)}:{quote(step.table_key, safe=safe)}",
            "connectorId": step.source_id,
            "tableKey": step.table_key,
            "sourceTable": {"id": step.source_table, "name": step.source_table_name or step.source_table},
            "displayName": (resolved or {}).get("display_name") or step.source_table_name or step.source_table,
            "capturedAt": datetime.now(timezone.utc).isoformat(),
            "summary": {
                "description": metadata.get("source_description") or metadata.get("description"),
                "columns": metadata.get("columns") or [],
                "rowCount": sizes.get("row_count"),
                "sizeBytes": next((sizes[key] for key in ("original_size_bytes", "size_bytes", "file_size") if key in sizes), None),
            },
        }

    def _publish_connector_query(
        self,
        table_name: str,
        step: ConnectorQueryStep,
        *,
        operation_id: str,
        plan_hash: str,
        step_index: int,
    ) -> str:
        loader = self._loader_resolver(step.source_id)
        import_options = self._build_import_options(step)
        aggregate_query = bool(step.query.group_by or step.query.aggregates or step.query.native)
        if aggregate_query:
            table = execute_aggregate_query(loader, step.source_table, step.query)
        else:
            table = execute_source_query(
                loader, "fetch_data_as_arrow",
                source_table=step.source_table,
                import_options=import_options,
            )
        if not isinstance(table, pa.Table):
            raise TypeError("Connector query must return pyarrow.Table")
        table = apply_import_projection(table, import_options)
        if step.query.limit is not None and table.num_rows > step.query.limit:
            table = table.slice(0, step.query.limit)

        check_cancelled()
        metadata = self._workspace.write_parquet_from_arrow(
            table,
            table_name,
            source_info={
                "loader_type": loader.__class__.__name__,
                "loader_params": loader.get_safe_params(),
                "source_table": step.source_table,
                "import_options": {
                **import_options,
                "data_operation": {
                    "operation_id": operation_id,
                    "plan_hash": plan_hash,
                    "step_index": step_index,
                    "source_id": step.source_id,
                    "table_key": step.table_key,
                    **({"lineage_verified": False} if step.query.native else {}),
                },
            },
            },
        )
        # Parity with ExternalDataLoader.ingest_to_workspace: without this the
        # published table carries no source description or column descriptions.
        try:
            source_meta = {} if aggregate_query else loader.get_column_types(step.source_table)
            if source_meta:
                _merge_source_metadata(metadata, source_meta)
                self._workspace.add_table_metadata(metadata)
        except Exception:
            logger.debug("Metadata enrichment skipped for %s", table_name, exc_info=True)
        scope = {
            "source_id": step.source_id,
            "table_key": step.table_key,
            "filters": import_options.get("source_filters", []),
            "columns": import_options.get("columns", "all"),
            "order_by": [{"column": item.column, "direction": item.direction} for item in step.query.order_by],
            "requested_limit": step.query.limit,
            "loaded_row_count": table.num_rows,
                **({"query": step.query.to_dict(), "coverage": "query_defined" if step.query.native else "requested_limit" if step.query.limit else "complete_aggregate_result"}
                    if aggregate_query else {}),
        }
        scope_description = (
            f"Workspace table: {step.display_name}. Import scope: "
            + json.dumps(scope, ensure_ascii=False, default=str)
            + ". Coverage is subject to connector limits; loaded row count is not a source total."
        )
        metadata.description = "\n\n".join(part for part in (metadata.description, scope_description) if part)
        self._workspace.add_table_metadata(metadata)
        return metadata.name

    def _find_published_results(
        self,
        operation_id: str,
        plan_hash: str,
    ) -> dict[int, str]:
        matches: dict[int, str] = {}
        for table_name in self._workspace.list_tables():
            metadata = self._workspace.get_table_metadata(table_name)
            provenance = (
                metadata.import_options.get("data_operation")
                if metadata is not None and isinstance(metadata.import_options, dict)
                else None
            )
            if not isinstance(provenance, dict):
                continue
            if (
                provenance.get("operation_id") == operation_id
                and provenance.get("plan_hash") == plan_hash
                and isinstance(provenance.get("step_index"), int)
            ):
                matches[provenance["step_index"]] = table_name
        return matches

    @staticmethod
    def _build_import_options(step: ConnectorQueryStep) -> dict:
        options: dict = {}
        if step.query.group_by or step.query.aggregates or step.query.native:
            options["structured_query"] = step.query.to_dict()
        if step.query.limit is not None:
            options["size"] = step.query.limit
        if step.query.filters:
            options["source_filters"] = [item.to_dict() for item in step.query.filters]
        if step.query.columns:
            options["columns"] = list(step.query.columns)
        if step.query.order_by:
            options["sort_columns"] = [item.column for item in step.query.order_by]
            options["sort_order"] = step.query.order_by[0].direction
        return options

    @staticmethod
    def _requested_table_name(step: ConnectorQueryStep) -> str:
        source = step.source_table_name or step.source_table
        path = PurePosixPath(urlsplit(source).path if "://" in source else source)
        file_source = path.suffix.lower() in {".csv", ".tsv", ".parquet", ".json", ".jsonl", ".xlsx"}
        basename = path.stem if file_source else path.name
        label = step.display_name.strip()
        if not file_source and "/" not in source:
            return label
        generic_names = {sanitize_table_name(value) for value in (source, step.source_table, basename, path.name)}
        if sanitize_table_name(label) in generic_names:
            hints = []
            for predicate in step.query.filters[:2]:
                value = predicate.to_dict()
                hints.append("_".join(str(part) for part in (
                    value["column"], value["operator"],
                    json.dumps(value.get("value"), ensure_ascii=False, default=str),
                )))
            if step.query.limit is not None:
                hints.append(f"first_{step.query.limit}")
            if hints:
                label = "_".join(hints)
            else:
                return basename
        basename = sanitize_table_name(basename)
        if len(basename) > 32:
            digest = hashlib.sha256(basename.encode("utf-8")).hexdigest()[:6]
            basename = f"{basename[:25].rstrip('_')}_{digest}"
        return f"{basename}__{label}"

    @staticmethod
    def _allocate_table_name(requested_name: str, used: set[str]) -> str:
        base = sanitize_table_name(requested_name)
        if len(base) > 80:
            digest = hashlib.sha256(requested_name.encode("utf-8")).hexdigest()[:8]
            base = f"{base[:71].rstrip('_')}_{digest}"
        candidate = base
        suffix = 2
        while candidate in used:
            ending = f"_{suffix}"
            candidate = f"{base[:80 - len(ending)]}{ending}"
            suffix += 1
        return candidate

    @staticmethod
    def _resolve_live_loader(source_id: str) -> ExternalDataLoader:
        from data_formulator.data_connector import resolve_live_loader

        return resolve_live_loader(source_id)