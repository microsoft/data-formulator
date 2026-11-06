# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Where user-added MCP servers are kept (local mode only).

``<DF home>/mcp.json`` holds each server's definition: how to reach it, its
sign-in method (not the secret), and a snapshot of its tools as the user last reviewed them, with
per-tool switches. Secrets — header values, environment variables, OAuth client secrets and
tokens — go to the credential vault under ``mcp:<server id>``, never into this file.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

MODES = ("off", "ask", "auto")
TRANSPORTS = ("http", "sse", "stdio")
AUTH_TYPES = ("none", "header", "oauth")
MAX_SERVERS = 32
MAX_TOOL_DESCRIPTION = 2000
MAX_INSTRUCTIONS = 4000
_SERVER_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,23}$")
_lock = threading.RLock()


class McpConfigError(ValueError):
    pass


def config_path() -> Path:
    from data_formulator.datalake.workspace import get_data_formulator_home

    return get_data_formulator_home() / "mcp.json"


def mcp_available() -> bool:
    """MCP servers are a single-user local feature; hosted and managed deployments do not offer them."""
    from data_formulator.auth.identity import is_local_mode
    from data_formulator.configuration import user_connectors_disabled

    return is_local_mode() and not user_connectors_disabled()


def valid_server_id(server_id: Any) -> bool:
    return isinstance(server_id, str) and bool(_SERVER_ID.fullmatch(server_id))


def read_config() -> dict[str, Any]:
    with _lock:
        try:
            data = json.loads(config_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
    servers = data.get("servers") if isinstance(data.get("servers"), dict) else {}
    return {"servers": {key: value for key, value in servers.items()
                                      if valid_server_id(key) and isinstance(value, dict)}}


def write_config(config: dict[str, Any]) -> None:
    path = config_path()
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle, temporary = tempfile.mkstemp(prefix=".mcp-", dir=path.parent)
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as stream:
                json.dump(config, stream, indent=2, ensure_ascii=False)
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        except BaseException:
            Path(temporary).unlink(missing_ok=True)
            raise


def mcp_servers_on() -> int:
    """How many of the user's MCP servers are switched on (0 when MCP is unavailable)."""
    if not mcp_available():
        return 0
    return sum(1 for server in read_config()["servers"].values() if server.get("enabled", True))


def mcp_mode() -> str:
    """The agent's tools share one approval mode with the terminal (``configuration.tools_mode``)."""
    from data_formulator.configuration import tools_mode

    return tools_mode() if mcp_available() else "off"


def get_server(server_id: str) -> dict[str, Any] | None:
    return read_config()["servers"].get(server_id)


def add_server(raw: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        config = read_config()
        if len(config["servers"]) >= MAX_SERVERS:
            raise McpConfigError(f"At most {MAX_SERVERS} MCP servers can be added.")
        server_id = new_server_id(str(raw.get("name") or ""), set(config["servers"]))
        server = normalize_server(raw, server_id=server_id)
        config["servers"][server_id] = server
        write_config(config)
        return server


def update_server(server_id: str, change) -> dict[str, Any]:
    """Apply ``change(server)`` to a stored server under the config lock and save it."""
    with _lock:
        config = read_config()
        server = config["servers"].get(server_id)
        if server is None:
            raise McpConfigError("Unknown MCP server.")
        change(server)
        config["servers"][server_id] = server
        write_config(config)
        return server


def delete_server(server_id: str) -> None:
    with _lock:
        config = read_config()
        if config["servers"].pop(server_id, None) is not None:
            write_config(config)


# -- server definitions ---------------------------------------------------------------------------

def _slug(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:24].strip("-")
    return slug or "server"


def new_server_id(name: str, existing: set[str]) -> str:
    base = _slug(name)
    candidate, suffix = base, 2
    while candidate in existing:
        tail = f"-{suffix}"
        candidate = base[:24 - len(tail)].strip("-") + tail
        suffix += 1
    return candidate


def _check_url(url: Any) -> str:
    if not isinstance(url, str) or not url.strip() or len(url) > 2000:
        raise McpConfigError("Give the server's URL.")
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise McpConfigError("The server URL must start with https:// (or http:// for this computer).")
    if parts.scheme == "http" and parts.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise McpConfigError("Use https:// for remote servers; plain http:// is only allowed for this computer.")
    return url.strip()


def normalize_server(raw: dict[str, Any], *, server_id: str) -> dict[str, Any]:
    """Validate the user-editable part of a server definition (no secrets)."""
    if not isinstance(raw, dict):
        raise McpConfigError("Server definition must be an object.")
    name = str(raw.get("name") or "").strip()
    if not name or len(name) > 64:
        raise McpConfigError("Give the server a name (up to 64 characters).")
    transport = raw.get("transport", "http")
    if transport not in TRANSPORTS:
        raise McpConfigError("Transport must be http, sse or stdio.")
    server: dict[str, Any] = {"id": server_id, "name": name, "transport": transport,
                              "enabled": raw.get("enabled", True) is not False}
    if transport in ("http", "sse"):
        server["url"] = _check_url(raw.get("url"))
        auth = raw.get("auth") if isinstance(raw.get("auth"), dict) else {}
        auth_type = auth.get("type", "none")
        if auth_type not in AUTH_TYPES:
            raise McpConfigError("Sign-in must be none, header or oauth.")
        clean: dict[str, Any] = {"type": auth_type}
        if auth_type == "header":
            header = str(auth.get("header") or "Authorization").strip()
            if not re.fullmatch(r"[A-Za-z0-9-]{1,64}", header):
                raise McpConfigError("Header name may use letters, digits and hyphens.")
            clean["header"] = header
        if auth_type == "oauth":
            for key in ("client_id", "scope"):
                value = auth.get(key)
                if value:
                    if not isinstance(value, str) or len(value) > 500:
                        raise McpConfigError(f"Invalid OAuth {key.replace('_', ' ')}.")
                    clean[key] = value.strip()
        server["auth"] = clean
    else:
        command = raw.get("command")
        args = raw.get("args", [])
        if not isinstance(command, str) or not command.strip() or len(command) > 1000:
            raise McpConfigError("Give the command that starts the server (e.g. npx or uvx).")
        if (not isinstance(args, list) or len(args) > 64
                or any(not isinstance(arg, str) or len(arg) > 2000 or "\0" in arg for arg in args)):
            raise McpConfigError("Arguments must be a list of strings.")
        server.update(command=command.strip(), args=list(args))
        cwd = raw.get("cwd")
        if cwd:
            if not isinstance(cwd, str) or not Path(cwd).expanduser().is_absolute():
                raise McpConfigError("The working directory must be an absolute path.")
            server["cwd"] = cwd
        server["auth"] = {"type": "none"}
    pack = raw.get("pack")
    if pack is not None:
        from data_formulator.tool_packs import PACKS

        if pack not in PACKS:
            raise McpConfigError("Unknown tool pack.")
        server["pack"] = pack
    return server


def check_secrets(raw: Any) -> dict[str, Any]:
    """Validate secrets supplied with a server: a header value, stdio environment variables, an OAuth client secret."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise McpConfigError("Secrets must be an object.")
    secrets: dict[str, Any] = {}
    if raw.get("header_value") is not None:
        value = raw["header_value"]
        if not isinstance(value, str) or len(value) > 8000 or "\n" in value or "\r" in value:
            raise McpConfigError("Invalid header value.")
        secrets["header_value"] = value
    if raw.get("env") is not None:
        env = raw["env"]
        if (not isinstance(env, dict) or len(env) > 64
                or any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", str(key)) or not isinstance(value, str)
                       or len(value) > 8000 or "\0" in value for key, value in env.items())):
            raise McpConfigError("Environment variables must map NAMES to string values.")
        secrets["env"] = dict(env)
    if raw.get("client_secret") is not None:
        value = raw["client_secret"]
        if not isinstance(value, str) or len(value) > 2000:
            raise McpConfigError("Invalid OAuth client secret.")
        secrets["client_secret"] = value
    return secrets


# -- tool snapshots -------------------------------------------------------------------------------

def _annotations(tool: Any) -> dict[str, Any]:
    annotations = getattr(tool, "annotations", None)
    if annotations is None:
        return {}
    keys = {"read_only_hint": "readOnly", "destructive_hint": "destructive",
            "idempotent_hint": "idempotent", "open_world_hint": "openWorld"}
    return {short: getattr(annotations, key) for key, short in keys.items() if getattr(annotations, key, None) is not None}


def tool_snapshot(tool: Any) -> dict[str, Any]:
    """A tool as the user reviews it, with a fingerprint over everything the agent will be shown."""
    schema = getattr(tool, "input_schema", None) or {"type": "object", "properties": {}}
    snapshot = {
        "name": tool.name,
        "title": getattr(tool, "title", None) or getattr(getattr(tool, "annotations", None), "title", None),
        "description": (getattr(tool, "description", None) or "")[:MAX_TOOL_DESCRIPTION],
        "input_schema": schema,
        "annotations": _annotations(tool),
    }
    snapshot["fingerprint"] = fingerprint(snapshot)
    return snapshot


def fingerprint(snapshot: dict[str, Any]) -> str:
    material = {key: snapshot.get(key) for key in ("name", "description", "input_schema", "annotations")}
    return hashlib.sha256(json.dumps(material, sort_keys=True, default=str).encode()).hexdigest()[:32]


def merge_tools(server: dict[str, Any], tools: list[Any], instructions: str | None) -> None:
    """Record the server's current tools. On the first connection they are the user's review; after
    that, a new tool or one whose definition changed is held (``pending``) until the user approves."""
    first = not server.get("connected_once")
    previous = {tool["name"]: tool for tool in server.get("tools", [])}
    merged = []
    for tool in tools:
        snapshot = tool_snapshot(tool)
        before = previous.get(snapshot["name"])
        if before is None:
            snapshot.update(enabled=True, always_allow=False, pending=not first)
        else:
            snapshot.update(enabled=before.get("enabled", True), always_allow=before.get("always_allow", False),
                            pending=bool(before.get("pending")) or before.get("fingerprint") != snapshot["fingerprint"])
            if snapshot["pending"]:
                snapshot["always_allow"] = False
        merged.append(snapshot)
    server["tools"] = merged
    server["changed"] = any(snapshot["pending"] for snapshot in merged)
    server["instructions"] = (instructions or "")[:MAX_INSTRUCTIONS]
    server["connected_once"] = True


def approve_tools(server: dict[str, Any]) -> None:
    for snapshot in server.get("tools", []):
        snapshot["pending"] = False
    server["changed"] = False


def tool_is_current(server: dict[str, Any], live: Any) -> bool:
    """Whether a tool as the server describes it now matches what the user approved."""
    stored = next((tool for tool in server.get("tools", []) if tool["name"] == live.name), None)
    return bool(stored) and not stored.get("pending") and stored["fingerprint"] == tool_snapshot(live)["fingerprint"]


def public_server(server: dict[str, Any], secrets: dict[str, Any] | None = None) -> dict[str, Any]:
    """The server as the settings view shows it: no secrets, only which ones are set."""
    view = {key: value for key, value in server.items() if key != "connected_once"}
    secrets = secrets or {}
    view["secrets"] = {
        "header": bool(secrets.get("header_value")),
        "env": sorted((secrets.get("env") or {}).keys()),
        "client_secret": bool(secrets.get("client_secret")),
        "signed_in": bool(secrets.get("tokens")),
    }
    return view


# -- secrets (credential vault) ---------------------------------------------------------------------

def _vault():
    from data_formulator.auth.vault import get_credential_vault

    vault = get_credential_vault()
    if vault is None:
        raise McpConfigError("The credential vault is turned off, so MCP server secrets cannot be stored.")
    return vault


def read_secrets(identity: str, server_id: str) -> dict[str, Any]:
    from data_formulator.auth.vault import get_credential_vault

    vault = get_credential_vault()
    return (vault.retrieve(identity, f"mcp:{server_id}") if vault else None) or {}


def write_secrets(identity: str, server_id: str, secrets: dict[str, Any]) -> None:
    cleaned = {key: value for key, value in secrets.items() if value}
    if cleaned:
        _vault().store(identity, f"mcp:{server_id}", cleaned)
    else:
        delete_secrets(identity, server_id)


def update_secrets(identity: str, server_id: str, change) -> dict[str, Any]:
    with _lock:
        secrets = read_secrets(identity, server_id)
        change(secrets)
        write_secrets(identity, server_id, secrets)
        return secrets


def delete_secrets(identity: str, server_id: str) -> None:
    from data_formulator.auth.vault import get_credential_vault

    vault = get_credential_vault()
    if vault:
        vault.delete(identity, f"mcp:{server_id}")
