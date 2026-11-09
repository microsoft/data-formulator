# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""``/api/mcp``: manage the user's MCP servers from the settings view (local mode only)."""

from __future__ import annotations

import html
import json
import logging
from typing import Any

from flask import Blueprint, Response, request

from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode
from data_formulator.mcp_servers import config as mcp_config

mcp_bp = Blueprint("mcp_servers", __name__, url_prefix="/api/mcp")
logger = logging.getLogger(__name__)


def _identity() -> str:
    from data_formulator.auth.identity import get_identity_id

    if not mcp_config.mcp_available():
        raise AppError(ErrorCode.ACCESS_DENIED, "MCP servers are available only in single-user local mode.")
    identity = get_identity_id()
    if not identity.startswith("local:"):
        raise AppError(ErrorCode.ACCESS_DENIED, "MCP servers are available only in single-user local mode.")
    return identity


def _mutation() -> str:
    from data_formulator.mcp_servers.skill import require_local_mcp_request

    identity = _identity()
    try:
        require_local_mcp_request()
    except ValueError as exc:
        raise AppError(ErrorCode.ACCESS_DENIED, str(exc)) from None
    if request.headers.get("X-DF-Configuration") != "1":
        raise AppError(ErrorCode.ACCESS_DENIED, "Use the application to change MCP servers.")
    return identity


def _body() -> dict[str, Any]:
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise AppError(ErrorCode.INVALID_REQUEST, "Send a JSON object.")
    return body


def _invalid(exc: Exception) -> AppError:
    return AppError(ErrorCode.INVALID_REQUEST, str(exc))


def _server_view(identity: str, server: dict[str, Any]) -> dict[str, Any]:
    return mcp_config.public_server(server, mcp_config.read_secrets(identity, server["id"]))


def _snapshot(identity: str) -> dict[str, Any]:
    config = mcp_config.read_config()
    return {"available": True, "mode": mcp_config.mcp_mode(),
            "servers": [_server_view(identity, server) for server in config["servers"].values()]}


def _redirect_uri() -> str:
    return request.host_url.rstrip("/") + "/api/mcp/oauth/callback"


def _record_connection(identity: str, server_id: str, outcome: dict[str, Any] | None, error: str | None) -> dict[str, Any]:
    def change(server: dict[str, Any]) -> None:
        if outcome and outcome.get("status") == "connected":
            mcp_config.merge_tools(server, outcome["tools"], outcome.get("instructions"))
            server.update(status="connected", error=None)
        elif outcome and outcome.get("status") == "authorize":
            server.update(status="signing_in", error=None)
        else:
            server.update(status="error", error=error)
    return _server_view(identity, mcp_config.update_server(server_id, change))


@mcp_bp.route("", methods=["GET"])
def list_servers():
    from data_formulator.auth.identity import is_local_mode

    if not mcp_config.mcp_available() or not is_local_mode():
        return json_ok({"available": False, "mode": "off", "servers": []})
    return json_ok(_snapshot(_identity()))


@mcp_bp.route("/servers", methods=["POST"])
def add_server():
    identity = _mutation()
    body = _body()
    try:
        secrets = mcp_config.check_secrets(body.get("secrets"))
        server = mcp_config.add_server(body)
        if secrets:
            mcp_config.write_secrets(identity, server["id"], secrets)
    except ValueError as exc:
        raise _invalid(exc) from None
    return json_ok(_server_view(identity, server))


@mcp_bp.route("/servers/<server_id>", methods=["PUT", "DELETE"])
def change_server(server_id: str):
    from data_formulator.mcp_servers.hub import get_hub

    identity = _mutation()
    if not mcp_config.valid_server_id(server_id) or mcp_config.get_server(server_id) is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "Unknown MCP server.")
    if request.method == "DELETE":
        mcp_config.delete_server(server_id)
        mcp_config.delete_secrets(identity, server_id)
        get_hub().close(server_id)
        return json_ok(_snapshot(identity))
    body = _body()
    try:
        secrets = mcp_config.check_secrets(body.get("secrets")) if "secrets" in body else None
        definition_keys = {"name", "transport", "url", "command", "args", "cwd", "auth"}

        def change(server: dict[str, Any]) -> None:
            if definition_keys & set(body):
                definition = mcp_config.normalize_server(
                    {**server, **{key: body[key] for key in definition_keys if key in body}}, server_id=server_id)
                moved = any(server.get(key) != definition.get(key) for key in ("transport", "url", "command", "args", "cwd", "auth"))
                server.update(definition)
                for key in ("url", "command", "args", "cwd"):
                    if key not in definition:
                        server.pop(key, None)
                if moved:
                    server.update(status=None, error=None)
            if "enabled" in body:
                server["enabled"] = body["enabled"] is True
            if isinstance(body.get("tools"), list):
                switches = {item.get("name"): item for item in body["tools"] if isinstance(item, dict)}
                for tool in server.get("tools", []):
                    item = switches.get(tool["name"])
                    if item is None:
                        continue
                    if "enabled" in item:
                        tool["enabled"] = item["enabled"] is True
                    if "always_allow" in item:
                        tool["always_allow"] = item["always_allow"] is True
            if body.get("approve_changes") is True:
                mcp_config.approve_tools(server)

        server = mcp_config.update_server(server_id, change)
        if secrets is not None:
            def merge(stored: dict[str, Any]) -> None:
                for key, value in secrets.items():
                    stored[key] = value
                if body.get("clear_secrets"):
                    for key in body["clear_secrets"] if isinstance(body["clear_secrets"], list) else []:
                        stored.pop(key, None)
            mcp_config.update_secrets(identity, server_id, merge)
        if secrets is not None or definition_keys & set(body):
            get_hub().close(server_id)
    except ValueError as exc:
        raise _invalid(exc) from None
    return json_ok(_server_view(identity, server))


def _try_oauth(identity: str, server: dict[str, Any]) -> dict[str, Any] | None:
    """A server without sign-in settings refused access: try the MCP OAuth sign-in, as other MCP clients do.

    Returns the connect outcome, or None (with the server's sign-in setting restored) when it does not offer OAuth.
    """
    from data_formulator.mcp_servers.hub import get_hub

    if server.get("transport") == "stdio" or server.get("auth", {}).get("type") != "none":
        return None
    with_sign_in = mcp_config.update_server(server["id"], lambda stored: stored.update(auth={"type": "oauth"}))
    try:
        return get_hub().connect(identity, with_sign_in, redirect_uri=_redirect_uri())
    except Exception:  # noqa: BLE001 - no OAuth here; report the original refusal
        logger.info("MCP server %s refused access and offers no OAuth sign-in", server["id"], exc_info=True)
        mcp_config.update_server(server["id"], lambda stored: stored.update(auth={"type": "none"}))
        get_hub().close(server["id"])
        return None


@mcp_bp.route("/servers/<server_id>/connect", methods=["POST"])
def connect_server(server_id: str):
    from data_formulator.mcp_servers.hub import AccessRefused, error_message, get_hub

    identity = _mutation()
    server = mcp_config.get_server(server_id) if mcp_config.valid_server_id(server_id) else None
    if server is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "Unknown MCP server.")
    try:
        outcome = get_hub().connect(identity, server, redirect_uri=_redirect_uri())
    except AccessRefused as exc:
        outcome = _try_oauth(identity, server)
        if outcome is None:
            message = (f"{error_message(exc)} If it takes an API key, add it under \"headers\" "
                       "(for example \"Authorization\": \"Bearer …\").")
            return json_ok({"status": "error", "server": _record_connection(identity, server_id, None, message)})
    except Exception as exc:  # noqa: BLE001 - shown to the user in settings
        return json_ok({"status": "error", "server": _record_connection(identity, server_id, None, error_message(exc))})
    view = _record_connection(identity, server_id, outcome, None)
    if outcome["status"] == "authorize":
        return json_ok({"status": "authorize", "url": outcome["url"], "server": view})
    return json_ok({"status": "connected", "server": view})


@mcp_bp.route("/servers/<server_id>/sign-out", methods=["POST"])
def sign_out(server_id: str):
    from data_formulator.mcp_servers.hub import get_hub

    identity = _mutation()
    if not mcp_config.valid_server_id(server_id) or mcp_config.get_server(server_id) is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "Unknown MCP server.")
    mcp_config.update_secrets(identity, server_id, lambda stored: (stored.pop("tokens", None), stored.pop("client_info", None)))
    get_hub().close(server_id)
    server = mcp_config.update_server(server_id, lambda stored: stored.update(status=None, error=None))
    return json_ok(_server_view(identity, server))


_CALLBACK_PAGE = """<!doctype html><meta charset="utf-8"><title>Data Formulator</title>
<body style="font-family: system-ui, sans-serif; padding: 2rem; color: #333">
<p>{message}</p><p style="color:#777">You can close this window.</p>
<script>try {{ window.opener && window.opener.postMessage({payload}, window.location.origin); }} catch (e) {{}}
setTimeout(function () {{ window.close(); }}, {delay});</script></body>"""


def _callback_page(message: str, ok: bool, server_id: str | None) -> Response:
    payload = json.dumps({"type": "df-mcp-oauth", "ok": ok, "server": server_id}).replace("<", "\\u003c")
    body = _CALLBACK_PAGE.format(message=html.escape(message), payload=payload, delay=600 if ok else 4000)
    return Response(body, mimetype="text/html", headers={"Cache-Control": "no-store",
                                                          "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"})


@mcp_bp.route("/oauth/callback", methods=["GET"])
def oauth_callback():
    from data_formulator.mcp_servers.hub import error_message, get_hub

    identity = _identity()
    state = request.args.get("state", "")
    hub = get_hub()
    server_id = hub.sign_ins.resolve(state, code=request.args.get("code"),
                                     error=request.args.get("error_description") or request.args.get("error"))
    if server_id is None:
        return _callback_page("This sign-in link expired. Connect to the server again from Data Formulator.", False, None)
    server = mcp_config.get_server(server_id)
    if server is None:
        return _callback_page("This MCP server was removed.", False, server_id)
    try:
        outcome = hub.finish_sign_in(identity, server)
    except Exception as exc:  # noqa: BLE001 - shown to the user
        message = error_message(exc)
        _record_connection(identity, server_id, None, message)
        return _callback_page(f"Sign-in to {server['name']} failed: {message}", False, server_id)
    _record_connection(identity, server_id, outcome, None)
    return _callback_page(f"Signed in to {server['name']}.", True, server_id)


# -- import from other apps' configuration --------------------------------------------------------

def _parse_import(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        document = json.loads(text)
    except ValueError:
        import tomllib

        try:
            document = tomllib.loads(text)
        except tomllib.TOMLDecodeError:
            raise ValueError("Paste JSON (VS Code, Claude, Cursor) or TOML (Codex) MCP configuration.") from None
    if not isinstance(document, dict):
        raise ValueError("The configuration must be an object.")
    for key in ("mcpServers", "servers", "mcp_servers"):
        if isinstance(document.get(key), dict):
            return document[key]
    if isinstance(document.get("mcp"), dict) and isinstance(document["mcp"].get("servers"), dict):
        return document["mcp"]["servers"]
    if all(isinstance(value, dict) and ({"command", "url"} & set(value)) for value in document.values()) and document:
        return document
    raise ValueError("No MCP servers found. Expected mcpServers, servers or mcp_servers.")


def _import_entry(name: str, entry: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    notes: list[str] = []
    secrets: dict[str, Any] = {}
    kind = str(entry.get("type") or entry.get("transport") or "").lower()
    if entry.get("url") or kind in ("http", "sse", "streamable-http", "streamable_http"):
        headers = dict(entry.get("headers") or entry.get("http_headers") or {})
        token_variable = entry.get("bearer_token_env_var")
        auth: dict[str, Any] = {"type": "none"}
        if headers:
            header, value = next(iter(headers.items()))
            auth = {"type": "header", "header": header}
            secrets["header_value"] = str(value)
            if len(headers) > 1:
                notes.append("only the first header was kept")
        elif token_variable:
            import os

            auth = {"type": "header", "header": "Authorization"}
            if os.environ.get(token_variable):
                secrets["header_value"] = f"Bearer {os.environ[token_variable]}"
            else:
                notes.append(f"set the token ({token_variable}) in settings")
        oauth = entry.get("oauth")
        if oauth and not headers and not token_variable:
            oauth = oauth if isinstance(oauth, dict) else {}
            auth = {"type": "oauth", **{key: str(oauth[key]) for key in ("client_id", "scope") if oauth.get(key)}}
            if oauth.get("client_secret"):
                secrets["client_secret"] = str(oauth["client_secret"])
        raw = {"name": name, "transport": "sse" if kind == "sse" else "http", "url": entry.get("url"), "auth": auth}
    else:
        raw = {"name": name, "transport": "stdio", "command": entry.get("command"),
               "args": [str(arg) for arg in entry.get("args") or []], "cwd": entry.get("cwd")}
        if entry.get("env"):
            secrets["env"] = {str(key): str(value) for key, value in entry["env"].items()}
    empty = [key for key, value in secrets.get("env", {}).items() if not value]
    if "header_value" in secrets and not secrets["header_value"].strip():
        empty.insert(0, raw.get("auth", {}).get("header", "the header"))
    if empty:
        raise ValueError(f"fill in {', '.join(empty)}")
    if any("${" in str(value) for value in [*secrets.get("env", {}).values(), secrets.get("header_value", "")]):
        notes.append("replace ${…} placeholders with real values in settings")
    return raw, secrets, notes


@mcp_bp.route("/packs", methods=["GET"])
def list_tool_packs():
    from data_formulator.tool_packs import PACKS, list_packs

    identity = _identity()
    return json_ok({"packs": [_pack_entry(identity, pack["id"]) for pack in list_packs()]})


def _pack_server(pack_id: str) -> dict[str, Any] | None:
    return next((server for server in mcp_config.read_config()["servers"].values() if server.get("pack") == pack_id), None)


def _pack_entry(identity: str, pack_id: str) -> dict[str, Any]:
    """A pack as the Tools dialog shows it: its definition, the server it was added as, and (added) its settings'
    state and sign-in."""
    from data_formulator.tool_packs import PACKS, list_packs, pack_values

    pack = next(item for item in list_packs() if item["id"] == pack_id)
    server = _pack_server(pack_id)
    entry = {**pack, "server_id": server["id"] if server else None}
    if server:
        entry["values"] = pack_values(pack_id, server, mcp_config.read_secrets(identity, server["id"]))
    if PACKS[pack_id].get("signin"):
        entry["signin"] = {**pack["signin"], **_signin_state(identity, pack_id, entry["server_id"])}
    return entry


@mcp_bp.route("/packs/<pack_id>/tools", methods=["GET"])
def list_pack_tools(pack_id: str):
    """The tools a pack offers, to show before it is added."""
    from data_formulator.tool_packs import PackError, pack_tools

    _identity()
    try:
        return json_ok({"tools": list(pack_tools(pack_id))})
    except PackError as exc:
        raise _invalid(exc) from None


@mcp_bp.route("/packs/<pack_id>/settings", methods=["PUT"])
def change_pack_settings(pack_id: str):
    """Change an added pack's settings: a plain one rebuilds its server's arguments; a key is set (or, empty, removed)
    in the vault. The server restarts with them."""
    from data_formulator.tool_packs import PACKS, PackError, pack_secrets, pack_server, pack_values

    identity = _mutation()
    pack = PACKS.get(pack_id)
    server = _pack_server(pack_id)
    if pack is None or server is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "Add the toolkit before changing its settings.")
    body = _body()
    changes = body.get("settings") if isinstance(body.get("settings"), dict) else {}
    known = {setting["key"]: setting for setting in pack["settings"]}
    unknown = [key for key in changes if key not in known]
    if unknown:
        raise AppError(ErrorCode.INVALID_REQUEST, f"This toolkit has no setting {', '.join(map(repr, unknown))}.")
    secrets = mcp_config.read_secrets(identity, server["id"])
    plain = {key: value["value"] for key, value in pack_values(pack_id, server, secrets).items() if "value" in value}
    plain.update({key: str(value or "").strip() for key, value in changes.items() if not known[key].get("secret")})
    keyed = {key: str(value or "").strip() for key, value in changes.items() if known[key].get("secret")}
    try:
        args = pack_server(pack_id, plain)["args"]
        added = (pack_secrets(pack_id, {key: value for key, value in keyed.items() if value}).get("env") or {})
    except PackError as exc:
        raise _invalid(exc) from None
    removed = {known[key]["env"] for key, value in keyed.items() if not value}

    def update_definition(stored: dict[str, Any]) -> None:
        stored["args"] = args

    def update_keys(stored: dict[str, Any]) -> None:
        env = {name: value for name, value in (stored.get("env") or {}).items() if name not in removed}
        env.update(added)
        if env:
            stored["env"] = env
        else:
            stored.pop("env", None)
    mcp_config.update_server(server["id"], update_definition)
    if keyed:
        mcp_config.update_secrets(identity, server["id"], update_keys)
        token_setting = (pack.get("signin") or {}).get("token_setting")
        if token_setting in keyed:
            _note_pasted_token(identity, pack_id, server["id"])
    _restart(server["id"])
    return json_ok(_pack_entry(identity, pack_id))


# -- click-to-sign-in for a pack (GitHub, Hugging Face: the user's own account, read-only) -------------------------

def _signin_pack(pack_id: str) -> tuple[dict[str, Any], str]:
    """The pack's sign-in settings and its added server's id."""
    from data_formulator.tool_packs import PACKS

    signin = (PACKS.get(pack_id) or {}).get("signin")
    if not signin:
        raise AppError(ErrorCode.INVALID_REQUEST, "This toolkit has no sign-in.")
    server_id = next((server["id"] for server in mcp_config.read_config()["servers"].values() if server.get("pack") == pack_id), None)
    if server_id is None:
        raise AppError(ErrorCode.INVALID_REQUEST, "Add the toolkit before signing in.")
    return signin, server_id


def _copilot_connection(identity: str) -> dict[str, Any] | None:
    from data_formulator.auth.github_device_flow import connection_lock, connection_vault
    from data_formulator.routes.model_endpoints import _COPILOT_CONNECTION_KEY

    try:
        with connection_lock():
            stored = connection_vault().retrieve(identity, _COPILOT_CONNECTION_KEY)
    except AppError:
        return None
    return stored if stored and stored.get("access_token") else None


def _signin_state(identity: str, pack_id: str, server_id: str | None) -> dict[str, Any]:
    from data_formulator.tool_packs import PACKS
    from data_formulator.tool_packs import signin as pack_signin

    secrets = mcp_config.read_secrets(identity, server_id) if server_id else {}
    signin = PACKS[pack_id]["signin"]
    signed_in = bool((secrets.get("env") or {}).get(signin["env"]))
    # An account Data Formulator can already use (GitHub Copilot's; this computer's Hugging Face login), as it is.
    reusable = None if signed_in else pack_signin.reusable(signin["provider"], identity)
    return {"signed_in": signed_in, "login": secrets.get("signin_login") if signed_in else None,
            "reusable_login": reusable["login"] if reusable else None}


def _store_signin(identity: str, pack_id: str, server_id: str, token: str | None, login: str | None, **extra: Any) -> None:
    """Keep (or, with no token, drop) the pack's token in its server's secrets. Restart the server after."""
    from data_formulator.tool_packs import PACKS
    from data_formulator.tool_packs import signin as pack_signin

    env_name = PACKS[pack_id]["signin"]["env"]
    mcp_config.update_secrets(identity, server_id, lambda stored: pack_signin.signed_in(env_name, stored, token, login, **extra))


def _restart(server_id: str) -> None:
    from data_formulator.mcp_servers.hub import get_hub

    get_hub().close(server_id)  # it starts again with (or without) the token


@mcp_bp.route("/packs/<pack_id>/signin/start", methods=["POST"])
def start_pack_signin(pack_id: str):
    from data_formulator.tool_packs import signin as pack_signin

    identity = _mutation()
    _signin_pack(pack_id)
    return json_ok(pack_signin.flow(pack_id).start(identity))


@mcp_bp.route("/packs/<pack_id>/signin/poll", methods=["POST"])
def poll_pack_signin(pack_id: str):
    from data_formulator.tool_packs import signin as pack_signin

    identity = _mutation()
    signin, server_id = _signin_pack(pack_id)
    body = _body()
    flow = pack_signin.flow(pack_id)

    def exchange(token: str, response: dict[str, Any]) -> dict[str, Any]:
        login = pack_signin.account(signin["provider"], token)
        if not login:
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, f"{flow.provider.name} did not accept the sign-in. Try again.")
        return {"token": token, "login": login, "response": response}

    def commit(made: dict[str, Any]) -> None:
        # The client the token was issued to renews it.
        _store_signin(identity, pack_id, server_id, made["token"], made["login"], response=made["response"],
                      client_id=flow.client_id())

    result = flow.poll(identity, body.get("flow_id"), exchange, commit)
    if result["status"] == "connected":
        _restart(server_id)
    return json_ok({"flow": result, **_signin_state(identity, pack_id, server_id)})


@mcp_bp.route("/packs/<pack_id>/signin/cancel", methods=["POST"])
def cancel_pack_signin(pack_id: str):
    from data_formulator.tool_packs import signin as pack_signin

    identity = _mutation()
    _signin_pack(pack_id)
    pack_signin.flow(pack_id).cancel(identity, _body().get("flow_id"))
    return json_ok({})


@mcp_bp.route("/packs/<pack_id>/signin/reuse", methods=["POST"])
def reuse_pack_signin(pack_id: str):
    """Use an account Data Formulator can already use: GitHub Copilot's, or this computer's Hugging Face login."""
    from data_formulator.tool_packs import signin as pack_signin

    identity = _mutation()
    signin, server_id = _signin_pack(pack_id)
    found = pack_signin.reusable(signin["provider"], identity)
    login = pack_signin.account(signin["provider"], found["token"]) if found else None
    if not found or not login:
        raise AppError(ErrorCode.INVALID_REQUEST, "There is no sign-in to use. Sign in instead.")
    _store_signin(identity, pack_id, server_id, found["token"], login,
                  source="local" if found["source"] == "local" else None)
    _restart(server_id)
    return json_ok(_signin_state(identity, pack_id, server_id))


@mcp_bp.route("/packs/<pack_id>/signout", methods=["POST"])
def sign_out_of_pack(pack_id: str):
    identity = _mutation()
    _, server_id = _signin_pack(pack_id)
    _store_signin(identity, pack_id, server_id, None, None)
    _restart(server_id)
    return json_ok(_signin_state(identity, pack_id, server_id))


def _note_pasted_token(identity: str, pack_id: str, server_id: str) -> None:
    """A token the user pasted (the pack's ``token_setting``) is a sign-in too: name its account, and drop what
    renewed an earlier sign-in."""
    from data_formulator.tool_packs import PACKS
    from data_formulator.tool_packs import signin as pack_signin

    signin = PACKS[pack_id].get("signin")
    if not signin or not signin.get("token_setting"):
        return
    token = (mcp_config.read_secrets(identity, server_id).get("env") or {}).get(signin["env"])
    login = pack_signin.account(signin["provider"], token) if token else None
    _store_signin(identity, pack_id, server_id, token, login)


@mcp_bp.route("/packs/<pack_id>", methods=["POST"])
def add_tool_pack(pack_id: str):
    """Add a tool pack as an MCP server (once); connecting it is the client's next step."""
    from data_formulator.tool_packs import PackError, pack_secrets, pack_server

    identity = _mutation()
    body = _body()
    existing = next((server for server in mcp_config.read_config()["servers"].values() if server.get("pack") == pack_id), None)
    if existing is not None:
        return json_ok(_server_view(identity, existing))
    settings = body.get("settings") if isinstance(body.get("settings"), dict) else {}
    try:
        definition, secrets = pack_server(pack_id, settings), pack_secrets(pack_id, settings)
        server = mcp_config.add_server(definition)
    except (PackError, ValueError) as exc:
        raise _invalid(exc) from None
    if secrets:
        try:
            mcp_config.write_secrets(identity, server["id"], secrets)
        except mcp_config.McpConfigError as exc:
            mcp_config.delete_server(server["id"])  # not added without the key the user gave
            raise _invalid(exc) from None
        _note_pasted_token(identity, pack_id, server["id"])
    return json_ok(_server_view(identity, server))


@mcp_bp.route("/import", methods=["POST"])
def import_servers():
    identity = _mutation()
    body = _body()
    try:
        entries = _parse_import(str(body.get("config") or ""))
    except ValueError as exc:
        raise _invalid(exc) from None
    added, skipped = [], []
    for name, entry in list(entries.items())[:mcp_config.MAX_SERVERS]:
        if not isinstance(entry, dict):
            skipped.append({"name": str(name), "reason": "not a server definition"})
            continue
        try:
            raw, secrets, notes = _import_entry(str(name), entry)
            secrets = mcp_config.check_secrets(secrets)
            server = mcp_config.add_server(raw)
            if secrets:
                mcp_config.write_secrets(identity, server["id"], secrets)
            added.append({"id": server["id"], "name": server["name"], "notes": notes})
        except ValueError as exc:
            skipped.append({"name": str(name), "reason": str(exc)})
    return json_ok({**_snapshot(identity), "added": added, "skipped": skipped})
