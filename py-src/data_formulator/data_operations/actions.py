from __future__ import annotations

from typing import Any

from .models import DataOperation


def build_data_operation_action(operation: DataOperation) -> dict[str, Any]:
    return {
        "type": "data_operation",
        "operation": operation.to_public_dict(),
    }