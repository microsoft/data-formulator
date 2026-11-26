# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tool packs: ready-made MCP servers for a use case, added from the Tools dialog in one step.

A pack is a server Data Formulator ships (run with its own Python, so it needs no other install)
plus a few optional settings. Added, it is an ordinary MCP server: the same row, switches,
approvals and results as one the user configured; its ``pack`` field records where it came from.
A ``secret`` setting (an API key) never goes in the server's arguments: it is stored in the
credential vault and reaches the server as the environment variable its ``env`` names. A pack with
``signin`` offers click-to-sign-in instead (``mcp_servers/routes.py``): the token it gets is stored
the same way, as the environment variable ``signin["env"]``.
"""

from __future__ import annotations

import asyncio
import importlib
import re
import sys
from functools import lru_cache
from typing import Any

PACKS: dict[str, dict[str, Any]] = {
    "research": {
        "name": "Research",
        "server_name": "Research (arXiv + OpenAlex)",
        "description": "Search arXiv papers with citation counts from OpenAlex, follow new papers in a field, chart "
                       "publication trends and read full texts.",
        "examples": ["Find recent papers on LLM-based visualization and chart them by month",
                     "What's new in cs.HC this week?"],
        "settings": [{"key": "email", "label": "Contact email (optional)",
                      "description": "Sent to arXiv with each request, as arXiv asks of automated clients."},
                     {"key": "openalex_key", "label": "OpenAlex API key (optional)", "secret": True, "env": "OPENALEX_API_KEY",
                      "description": "Searches go to OpenAlex. Without a key they share a small daily budget with your "
                                     "network; a free key (openalex.org/settings/api) gives 10 times more."}],
        "module": "data_formulator.tool_packs.research",
    },
    "github": {
        "name": "GitHub",
        "server_name": "GitHub (public)",
        "description": "Search public GitHub repositories, code and issues, and read their READMEs and files. Read-only.",
        "examples": ["Find the most-starred Python data visualization libraries and chart their stars",
                     "What are the open bugs in vega/vega-lite about legends?"],
        "settings": [],
        # Sign in with GitHub, asking for no scopes: the token reads public data only, under the user's own limits.
        "signin": {"provider": "github", "env": "GITHUB_TOKEN"},
        "module": "data_formulator.tool_packs.github",
    },
    "huggingface": {
        "name": "Hugging Face datasets",
        "server_name": "Hugging Face datasets",
        "description": "Find datasets on the Hugging Face Hub, check their cards and rows, and load them as tables.",
        "examples": ["Find a dataset of world happiness scores and chart them by region",
                     "Load a dataset of daily US stock prices and compare a few tickers"],
        "settings": [{"key": "hf_token", "label": "Hugging Face token", "secret": True, "env": "HF_TOKEN",
                      "description": "A read token from huggingface.co/settings/tokens."}],
        # Sign in with Hugging Face (or this computer's Hugging Face login), or paste a token (`hf_token`): it opens
        # gated datasets the user accepted and raises the rate limits to the user's own.
        "signin": {"provider": "huggingface", "env": "HF_TOKEN", "token_setting": "hf_token"},
        "module": "data_formulator.tool_packs.huggingface",
    },
    "finance": {
        "name": "Finance",
        "server_name": "Finance",
        "description": "Company financials and filings from SEC EDGAR, economic series from FRED, and stock prices "
                       "(with a free Twelve Data key).",
        "examples": ["Chart Microsoft's and Apple's quarterly revenue over the last five years",
                     "How have the unemployment rate and the 10-year Treasury yield moved since 2020?"],
        "settings": [{"key": "email", "label": "Contact email", "required": True,
                      "description": "Sent to the SEC with each request, as it asks of automated clients."},
                     {"key": "twelvedata_key", "label": "Twelve Data API key (optional)", "secret": True,
                      "env": "TWELVE_DATA_API_KEY",
                      "description": "For stock prices: a free key (twelvedata.com) allows 800 requests a day."},
                     {"key": "fred_key", "label": "FRED API key (optional)", "secret": True, "env": "FRED_API_KEY",
                      "description": "For searching economic series by keyword; fetching a series by id needs no key. "
                                     "Free at fred.stlouisfed.org."}],
        "module": "data_formulator.tool_packs.finance",
    },
}

_EMAIL = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,63}")


class PackError(ValueError):
    pass


def list_packs() -> list[dict[str, Any]]:
    return [{"id": pack_id, **{key: pack[key] for key in ("name", "description", "examples")},
             "settings": [{key: value for key, value in setting.items() if key != "env"} for setting in pack["settings"]],
             **({"signin": {key: value for key, value in pack["signin"].items() if key != "env"}} if pack.get("signin") else {})}
            for pack_id, pack in PACKS.items()]


def pack_secrets(pack_id: str, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    """The pack's secret settings, as the server's secrets for the credential vault (``{"env": {...}}``)."""
    pack = PACKS.get(pack_id) or {}
    env = {setting["env"]: str((settings or {}).get(setting["key"]) or "").strip()
           for setting in pack.get("settings", []) if setting.get("secret")}
    env = {name: value for name, value in env.items() if value}
    if any(len(value) > 500 or any(char.isspace() for char in value) for value in env.values()):
        raise PackError("That key does not look right: paste it without spaces.")
    return {"env": env} if env else {}


@lru_cache(maxsize=None)
def pack_tools(pack_id: str) -> tuple[dict[str, Any], ...]:
    """The tools a pack's server offers (name, description, read-only), read from its code: what it will add."""
    pack = PACKS.get(pack_id)
    if pack is None:
        raise PackError(f"Unknown tool pack: {pack_id!r}.")
    app = importlib.import_module(f"{pack['module']}.server").app
    return tuple({"name": tool.name, "description": " ".join((tool.description or "").split()),
                  "read_only": bool(tool.annotations and tool.annotations.read_only_hint)}
                 for tool in asyncio.run(app.list_tools()))


def pack_values(pack_id: str, server: dict[str, Any], secrets: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """An added pack's settings as they stand: a plain one's value (from its server's arguments), and whether each
    secret one (a key, in the vault) is set. Secrets themselves never leave the vault."""
    args = list(server.get("args") or [])
    env = secrets.get("env") or {}
    values: dict[str, dict[str, Any]] = {}
    for setting in (PACKS.get(pack_id) or {}).get("settings", []):
        if setting.get("secret"):
            values[setting["key"]] = {"set": bool(env.get(setting["env"]))}
        else:
            flag = f"--{setting['key']}"
            values[setting["key"]] = {"value": args[args.index(flag) + 1] if flag in args[:-1] else ""}
    return values


def pack_server(pack_id: str, settings: dict[str, Any] | None = None) -> dict[str, Any]:
    """The MCP server definition that adds pack ``pack_id`` with the given settings."""
    from data_formulator.mcp_servers.config import config_path

    pack = PACKS.get(pack_id)
    if pack is None:
        raise PackError(f"Unknown tool pack: {pack_id!r}.")
    settings = settings or {}
    for setting in pack["settings"]:
        if setting.get("required") and not str(settings.get(setting["key"]) or "").strip():
            raise PackError(f"{setting['label']} is required.")
    args = ["-m", pack["module"], "--cache", str(config_path().parent / "cache" / pack_id)]
    email = str(settings.get("email") or "").strip()
    if email:
        if not _EMAIL.fullmatch(email):
            raise PackError("Enter a valid email address, or leave it empty.")
        args += ["--email", email]
    return {"name": pack["server_name"], "transport": "stdio", "command": sys.executable, "args": args, "pack": pack_id}
