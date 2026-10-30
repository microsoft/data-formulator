# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tool packs: ready-made MCP servers for a use case, added from the Tools dialog in one step.

A pack is a server Data Formulator ships (run with its own Python, so it needs no other install)
plus a few optional settings. Added, it is an ordinary MCP server: the same row, switches,
approvals and results as one the user configured; its ``pack`` field records where it came from.
"""

from __future__ import annotations

import re
import sys
from typing import Any

PACKS: dict[str, dict[str, Any]] = {
    "research": {
        "name": "Research",
        "server_name": "Research (arXiv)",
        "description": "Search arXiv, follow new papers in a field, chart publication trends and read full texts.",
        "examples": ["Find recent papers on LLM-based visualization and chart them by month",
                     "What's new in cs.HC this week?"],
        "settings": [{"key": "email", "label": "Contact email (optional)",
                      "description": "Sent to arXiv with each request, as arXiv asks of automated clients."}],
        "module": "data_formulator.tool_packs.research",
    },
}

_EMAIL = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,63}")


class PackError(ValueError):
    pass


def list_packs() -> list[dict[str, Any]]:
    return [{"id": pack_id, **{key: pack[key] for key in ("name", "description", "examples", "settings")}}
            for pack_id, pack in PACKS.items()]


def pack_server(pack_id: str, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    """The MCP server definition that adds pack ``pack_id`` with the given settings."""
    from data_formulator.mcp_servers.config import config_path

    pack = PACKS.get(pack_id)
    if pack is None:
        raise PackError(f"Unknown tool pack: {pack_id!r}.")
    settings = settings or {}
    args = ["-m", pack["module"], "--cache", str(config_path().parent / "cache" / pack_id)]
    email = str(settings.get("email") or "").strip()
    if email:
        if not _EMAIL.fullmatch(email):
            raise PackError("Enter a valid email address, or leave it empty.")
        args += ["--email", email]
    return {"name": pack["server_name"], "transport": "stdio", "command": sys.executable, "args": args, "pack": pack_id}
