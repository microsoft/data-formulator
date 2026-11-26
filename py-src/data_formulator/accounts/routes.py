# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""``/api/accounts``: the user's sign-ins (design-docs/72).

Listing is for the app; every change is a same-origin configuration request from the local app, like MCP setup.
Built-in services sign in by a code on their site, by reusing this computer's login, or by a pasted token; any other
service by saving a key for the spec the user confirmed on a sign-in card (``/custom``), checked before it is kept,
or by reusing this computer's login, read the way the spec says (``/custom/reuse``).
A sign-in is kept for the session the request comes from, or (``scope: user``) for every session. Secrets never
leave the server: responses carry the account's name, or the last characters of a key.
"""

from __future__ import annotations

from typing import Any

from flask import Blueprint, request

from data_formulator.error_handler import json_ok
from data_formulator.errors import AppError, ErrorCode

accounts_bp = Blueprint("accounts", __name__, url_prefix="/api/accounts")


def _identity() -> str:
    from data_formulator.accounts import accounts_available
    from data_formulator.auth.identity import get_identity_id

    if not accounts_available():
        raise AppError(ErrorCode.ACCESS_DENIED, "Sign-ins are available only in the single-user local app.")
    identity = get_identity_id()
    if not identity.startswith("local:"):
        raise AppError(ErrorCode.ACCESS_DENIED, "Sign-ins are available only in the single-user local app.")
    return identity


def _mutation() -> str:
    from data_formulator.mcp_servers.skill import require_local_mcp_request

    identity = _identity()
    try:
        require_local_mcp_request()
    except ValueError as exc:
        raise AppError(ErrorCode.ACCESS_DENIED, str(exc)) from None
    if request.headers.get("X-DF-Configuration") != "1":
        raise AppError(ErrorCode.ACCESS_DENIED, "Use the application to change sign-ins.")
    return identity


def _workspace() -> str | None:
    from data_formulator.workspace_factory import get_active_workspace_id

    return get_active_workspace_id() or None


def _body() -> dict[str, Any]:
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def _invalid(exc: Exception) -> AppError:
    return AppError(ErrorCode.INVALID_REQUEST, str(exc))


def _builtin(spec_id: str):
    from data_formulator.accounts.specs import builtin

    try:
        return builtin(spec_id)
    except ValueError as exc:
        raise _invalid(exc) from None


def _scope(body: dict[str, Any]) -> tuple[str, str | None]:
    """Where a new sign-in is kept: the open session by default; every session only when the user asks."""
    workspace = _workspace()
    scope = str(body.get("scope") or ("session" if workspace else "user"))
    workspace = workspace if scope == "session" else None
    if scope not in ("user", "session") or (scope == "session" and not workspace):
        raise AppError(ErrorCode.INVALID_REQUEST, "Keep a sign-in for every session, or for an open session.")
    return scope, workspace


def _state(identity: str, spec_id: str) -> dict[str, Any]:
    from data_formulator.accounts import store

    try:
        return store.state(identity, spec_id, _workspace())
    except ValueError as exc:
        raise _invalid(exc) from None


@accounts_bp.route("", methods=["GET"])
def list_accounts():
    from data_formulator.accounts import accounts_available, store

    if not accounts_available():
        return json_ok({"available": False, "accounts": []})
    return json_ok({"available": True, "accounts": store.all_states(_identity(), _workspace())})


@accounts_bp.route("/activity", methods=["GET"])
def list_activity():
    """What the user signed in to and what was done with it, newest first (no secrets)."""
    from data_formulator.accounts import accounts_available, activity

    if not accounts_available():
        return json_ok({"events": []})
    _identity()
    try:
        limit = max(1, min(int(request.args.get("limit", 300)), 1000))
    except ValueError:
        limit = 300
    return json_ok({"events": activity.recent(limit)})


@accounts_bp.route("/<spec_id>", methods=["GET"])
def get_account(spec_id: str):
    return json_ok(_state(_identity(), spec_id))


@accounts_bp.route("/custom", methods=["POST"])
def save_custom():
    """Keep a key for a service that is not built in, with the spec shown on the card (checked again here)."""
    from data_formulator.accounts import store

    identity = _mutation()
    body = _body()
    scope, workspace = _scope(body)
    secret = body.get("secret") if isinstance(body.get("secret"), dict) else {}
    try:
        spec = store.save_custom(identity, body.get("spec"), secret, scope=scope, workspace=workspace)
    except ValueError as exc:
        raise _invalid(exc) from None
    return json_ok(_state(identity, spec.id))


@accounts_bp.route("/custom/reuse", methods=["POST"])
def reuse_custom():
    """Sign in to the spec on a card with this computer's login, read the way the spec says (shown on the card)."""
    from data_formulator.accounts import store
    from data_formulator.accounts.specs import validate_spec

    identity = _mutation()
    body = _body()
    scope, workspace = _scope(body)
    try:
        spec = validate_spec(body.get("spec"))
        store.reuse_local(identity, spec, scope=scope, workspace=workspace)
    except ValueError as exc:
        raise _invalid(exc) from None
    return json_ok(_state(identity, spec.id))


@accounts_bp.route("/<spec_id>/signin/start", methods=["POST"])
def start_signin(spec_id: str):
    from data_formulator.accounts.specs import device_flow

    identity = _mutation()
    spec = _builtin(spec_id)
    if "device" not in spec.methods:
        raise AppError(ErrorCode.INVALID_REQUEST, f"{spec.name} has no device sign-in.")
    return json_ok(device_flow(spec).start(identity))


@accounts_bp.route("/<spec_id>/signin/poll", methods=["POST"])
def poll_signin(spec_id: str):
    from data_formulator.accounts import store
    from data_formulator.accounts.specs import device_flow

    identity = _mutation()
    spec = _builtin(spec_id)
    flow = device_flow(spec)

    def exchange(token: str, response: dict[str, Any]) -> dict[str, Any]:
        login = store.account_of(spec, token)
        if not login:
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, f"{spec.name} did not accept the sign-in. Try again.")
        return {"token": token, "login": login, "response": response}

    body = _body()
    scope, workspace = _scope(body)

    def commit(made: dict[str, Any]) -> None:
        store.save(identity, spec, {"token": made["token"]}, login=made["login"], source="device",
                   scope=scope, workspace=workspace, response=made["response"], client_id=flow.client_id(),
                   event="signed_in")

    result = flow.poll(identity, body.get("flow_id"), exchange, commit)
    return json_ok({"flow": result, **_state(identity, spec.id)})


@accounts_bp.route("/<spec_id>/signin/cancel", methods=["POST"])
def cancel_signin(spec_id: str):
    from data_formulator.accounts.specs import device_flow

    identity = _mutation()
    device_flow(_builtin(spec_id)).cancel(identity, _body().get("flow_id"))
    return json_ok({})


@accounts_bp.route("/<spec_id>/signin/reuse", methods=["POST"])
def reuse_signin(spec_id: str):
    from data_formulator.accounts import store

    identity = _mutation()
    spec = _builtin(spec_id)
    scope, workspace = _scope(_body())
    try:
        store.reuse_local(identity, spec.id, scope=scope, workspace=workspace)
    except ValueError as exc:
        raise _invalid(exc) from None
    return json_ok(_state(identity, spec.id))


@accounts_bp.route("/<spec_id>/token", methods=["POST"])
def paste_token(spec_id: str):
    from data_formulator.accounts import store

    identity = _mutation()
    spec = _builtin(spec_id)
    body = _body()
    scope, workspace = _scope(body)
    try:
        store.sign_in_with_token(identity, spec.id, str(body.get("token") or ""), scope=scope, workspace=workspace)
    except ValueError as exc:
        raise _invalid(exc) from None
    return json_ok(_state(identity, spec.id))


@accounts_bp.route("/<spec_id>/signout", methods=["POST"])
def sign_out(spec_id: str):
    """Sign out; a service that is not built in is forgotten with its key."""
    from data_formulator.accounts import store

    identity = _mutation()
    workspace = _workspace()
    known = store.spec_of(identity, spec_id, workspace)
    if known is None:
        raise AppError(ErrorCode.INVALID_REQUEST, f"No sign-in named {spec_id!r}.")
    store.sign_out(identity, spec_id, workspace, reason="signed out in the app")
    # A sign-in for every session may still apply once this session's own is gone.
    if known.verified or store.spec_of(identity, spec_id, workspace):
        return json_ok(_state(identity, spec_id))
    return json_ok({"id": spec_id, "removed": True})
