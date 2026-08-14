from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable

import pyarrow as pa

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
)


logger = logging.getLogger(__name__)


LoaderResolver = Callable[[str], ExternalDataLoader]


@dataclass(frozen=True)
class DataOperationExecutionResult:
    result_table_ids: tuple[str, ...]
    failed_steps: tuple[FailedOperationStep, ...] = ()


class DataOperationExecutor:
    def __init__(
        self,
        workspace,
        loader_resolver: LoaderResolver | None = None,
    ):
        self._workspace = workspace
        self._loader_resolver = loader_resolver or self._resolve_live_loader

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
        failed_steps: list[FailedOperationStep] = []
        for step_index, step in enumerate(plan.steps):
            if step_index in published:
                result_table_ids.append(published[step_index])
                continue
            table_name = self._allocate_table_name(step.display_name, used_names)
            used_names.add(table_name)
            try:
                result_table_ids.append(self._publish_connector_query(
                    table_name,
                    step,
                    operation_id=operation.id,
                    plan_hash=plan.plan_hash,
                    step_index=step_index,
                ))
            except Exception:
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
                        message=f"{step.display_name} could not be loaded.",
                    ),
                ))
        return DataOperationExecutionResult(
            tuple(result_table_ids),
            tuple(failed_steps),
        )

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
        table = loader.fetch_data_as_arrow(
            source_table=step.source_table,
            import_options=import_options,
        )
        if not isinstance(table, pa.Table):
            raise TypeError("Connector fetch_data_as_arrow must return pyarrow.Table")
        table = apply_import_projection(table, import_options)
        if step.query.limit is not None and table.num_rows > step.query.limit:
            table = table.slice(0, step.query.limit)

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
                },
            },
            },
        )
        # Parity with ExternalDataLoader.ingest_to_workspace: without this the
        # published table carries no source description or column descriptions.
        try:
            source_meta = loader.get_column_types(step.source_table)
            if source_meta:
                _merge_source_metadata(metadata, source_meta)
                self._workspace.add_table_metadata(metadata)
        except Exception:
            logger.debug("Metadata enrichment skipped for %s", table_name, exc_info=True)
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
    def _allocate_table_name(requested_name: str, used: set[str]) -> str:
        base = sanitize_table_name(requested_name)
        candidate = base
        suffix = 2
        while candidate in used:
            candidate = f"{base}_{suffix}"
            suffix += 1
        return candidate

    @staticmethod
    def _resolve_live_loader(source_id: str) -> ExternalDataLoader:
        from data_formulator.data_connector import resolve_live_loader

        return resolve_live_loader(source_id)