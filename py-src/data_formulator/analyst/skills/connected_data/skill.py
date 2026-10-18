# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Public-web discovery tools for the connected-data acquisition routes."""

from __future__ import annotations

import json
from typing import Any

from data_formulator.analyst.skills.base import SkillContext, ToolResult
from . import parallel_search


class ConnectedDataSkill:
    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        if name not in parallel_search.TOOL_NAMES:
            raise ValueError(f"connected_data has no tool {name!r}.")
        return ToolResult(text=json.dumps(parallel_search.call_tool(name, args), ensure_ascii=False))


def get_skill() -> ConnectedDataSkill:
    return ConnectedDataSkill()
