# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Handler for the ``demo`` skill's action: ``load_datasets``."""

from __future__ import annotations

from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext


def _ids(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))


def _error(message: str) -> Generator[Event, None, str]:
    yield {"type": "error", "message": message, "message_code": "agent.invalidDataOperation"}
    return f"[ERROR] {message}"


class DemoSkill:
    """Acts only for the demo named in the run's payload (``demo``), which the request set."""

    def handle_action(self, action: str, spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
        site_id = ctx.payload.get("demo")
        if not site_id:
            return (yield from _error(f"'{action}' is only available on a demo."))
        if action == "load_datasets":
            return (yield from self._load(site_id, _ids(spec.get("datasets")), ctx))
        return (yield from _error(f"demo has no action '{action}'."))

    @staticmethod
    def _load(site_id: str, ids: list[str], ctx: SkillContext) -> Generator[Event, None, str]:
        import json

        from data_formulator.analyst.skills.workspace.data_loading import record_data_operation_result
        from data_formulator.data_operations import ConnectorQueryStep, DataOperation, DataOperationPlan
        from data_formulator.data_operations.models import DataOperationStatus
        from data_formulator.sites.datasets import demo_datasets, load_datasets

        datasets = {dataset.id: dataset for dataset in demo_datasets(site_id)}
        if not ids:
            return (yield from _error("Name at least one dataset id to load."))
        unknown = [item for item in ids if item not in datasets]
        if unknown:
            return (yield from _error(f"Unknown dataset id(s): {', '.join(unknown)}. Choose from: {', '.join(datasets)}."))

        yield {"type": "tool_start", "tool": "load_data", "args": {"tables": [datasets[item].title for item in ids]}}
        result = load_datasets(ctx.workspace, site_id, ids)
        names = result.table_names
        failed = "; ".join(f"{datasets[item].title}: {reason}" for item, reason in result.failed.items())
        yield {"type": "tool_result", "tool": "load_data", "status": "error" if failed else "ok"}
        if names:
            plan = DataOperationPlan(
                label=", ".join(datasets[item].title for item in ids), summary="",
                steps=tuple(ConnectorQueryStep(source_id=f"demo:{site_id}", table_key=name, display_name=name, source_table=name)
                            for name in names))
            operation = DataOperation(
                reason="", plans=(plan,), description=str(ctx.payload.get("action_narration") or "").strip() or plan.label,
                status=DataOperationStatus.PARTIALLY_LOADED if failed else DataOperationStatus.LOADED,
                selected_plan_id=plan.id, result_table_ids=tuple(names))
            # Updates the run's view of the session's inputs; its own long observation is not needed here.
            record_data_operation_result(ctx.workspace, ctx.payload, operation)
            # The documents that came with the tables join them in the thread.
            yield {"type": "data_operation_result", "operation": operation.to_public_dict(),
                   **({"files": [{"path": f"files/{name}", "content_hash": digest}
                                 for name, digest in result.copied_files]} if result.copied_files else {})}

        report = []
        for item in ids:
            dataset = datasets[item]
            loaded = [{"table": table.name, "rows": table.rows, "description": table.description}
                      for table in result.loaded.get(item, [])]
            report.append({
                "dataset": item, "title": dataset.title,
                **({"loaded_tables": loaded} if loaded else {}),
                **({"already_in_session": result.present[item]} if result.present.get(item) else {}),
                "files": result.files.get(item, []),
                **({"error": result.failed[item]} if item in result.failed else {}),
            })
        guides = [path for paths in result.files.values() for path in paths if "guide" in path.lower()]
        note = (f"Read the data guide ({', '.join(guides)}) before choosing tables or indicators, then continue."
                if guides else "Continue the analysis with these tables.")
        return ("Loaded the datasets into the session.\n" if names else "Nothing new to load: these datasets are already in the session.\n") \
            + json.dumps(report, ensure_ascii=False) + "\n" + note


def get_skill() -> DemoSkill:
    return DemoSkill()
