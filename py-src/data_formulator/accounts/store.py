# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The user's sign-ins, in the credential vault: one record per spec, under ``account:<spec id>`` (design-docs/72).

A record holds the secret, the account it belongs to when the service names one, how it was made (``local``: this
computer's login, followed as it changes; ``device``: a code on the provider's site, renewed before it expires;
``token``: pasted), and its scope: ``session`` (one workspace, the app's default) or ``user`` (every session). A sign-in to a service
that is not built in also keeps the spec the user confirmed; its hosts never change after that. An index lists those
specs, since the vault has no listing. Secrets leave this module only for ``api_fetch``.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any

from data_formulator.accounts import activity
from data_formulator.accounts.local_logins import read_local
from data_formulator.accounts.specs import (BUILTIN, SignInSpec, SpecError, builtin, check_secret, device_flow,
                                            validate_spec)

logger = logging.getLogger(__name__)

REFRESH_MARGIN = 120
LOGIN_TTL = 600
SOURCES = ("local", "device", "token")
SCOPES = ("user", "session")
INDEX_KEY = "accounts:index"

_lock = threading.RLock()
_logins: dict[tuple[str, str], tuple[str | None, float]] = {}


class AccountError(ValueError):
    pass


def _vault(required: bool = True):
    from data_formulator.auth.vault import get_credential_vault

    vault = get_credential_vault()
    if vault is None and required:
        raise AccountError("The credential vault is turned off, so sign-ins cannot be kept.")
    return vault


def _key(spec_id: str, workspace: str | None = None) -> str:
    """A sign-in kept for every session, or (with ``workspace``) one kept for that session only: separate records,
    so saving one never replaces the other."""
    return f"account:{spec_id}:session:{workspace}" if workspace else f"account:{spec_id}"


def _read_one(identity: str, spec_id: str, workspace: str | None = None) -> dict[str, Any]:
    vault = _vault(required=False)
    return (vault.retrieve(identity, _key(spec_id, workspace)) if vault else None) or {}


def _read(identity: str, spec_id: str, workspace: str | None = None) -> dict[str, Any]:
    """The sign-in that applies in a session: one kept for that session, else the one for every session."""
    return (_read_one(identity, spec_id, workspace) if workspace else {}) or _read_one(identity, spec_id)


def _secret(record: dict[str, Any]) -> dict[str, str]:
    """The record's secret (a sign-in kept by the first prototype held a bare token)."""
    if isinstance(record.get("secret"), dict):
        return record["secret"]
    return {"token": record["token"]} if record.get("token") else {}


def _index(identity: str) -> list[tuple[str, str | None]]:
    """The user's own sign-ins (not built in), as (spec id, the session it is kept for or None)."""
    vault = _vault(required=False)
    stored = (vault.retrieve(identity, INDEX_KEY) if vault else None) or {}
    entries = []
    for item in stored.get("entries") or []:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            entries.append((item["id"], item.get("workspace") if isinstance(item.get("workspace"), str) else None))
    return entries


def _set_index(identity: str, entries: list[tuple[str, str | None]]) -> None:
    vault = _vault()
    unique = list(dict.fromkeys(entries))
    if unique:
        vault.store(identity, INDEX_KEY, {"entries": [{"id": spec_id, **({"workspace": ws} if ws else {})}
                                                      for spec_id, ws in unique]})
    else:
        vault.delete(identity, INDEX_KEY)


def _ids_for(identity: str, workspace: str | None) -> list[str]:
    """The user's own sign-ins that apply in a session: those for every session and those for this one."""
    return list(dict.fromkeys(spec_id for spec_id, ws in _index(identity) if ws is None or (workspace and ws == workspace)))


def spec_of(identity: str, spec_id: str, workspace: str | None = None) -> SignInSpec | None:
    """A built-in spec, or the one the user saved under this id (checked again as it is read), or None."""
    if spec_id in BUILTIN:
        return BUILTIN[spec_id]
    record = _read(identity, spec_id, workspace)
    try:
        return validate_spec(record["spec"]) if isinstance(record.get("spec"), dict) else None
    except SpecError:
        logger.warning("Ignoring a saved sign-in whose spec no longer validates: %s", spec_id)
        return None


def account_of(spec: SignInSpec, token: str) -> str | None:
    """The account a built-in's token belongs to, remembered a few minutes. Only an answer is remembered: a failed
    lookup (refused, or the provider unreachable) is asked again next time."""
    if spec.whoami is None:
        return None
    cached = _logins.get((spec.id, token))
    if cached and time.time() - cached[1] < LOGIN_TTL:
        return cached[0]
    login = spec.whoami(token)
    if login:
        _logins[(spec.id, token)] = (login, time.time())
    return login


def local_login(spec: SignInSpec) -> dict[str, Any] | None:
    """A built-in's login on this computer, usable as it is: ``{secret, login}``, or None."""
    token = spec.local_token() if spec.local_token else None
    login = account_of(spec, token) if token else None
    return {"secret": {"token": token}, "login": login} if token and login else None


def _read_spec_local(spec: SignInSpec) -> dict[str, str] | None:
    """The secret this computer's login holds, as the spec reads it, checked like a pasted key; None otherwise."""
    secret = read_local(spec.local, spec.auth.type) if spec.local else None
    try:
        return check_secret(spec, secret) if secret else None
    except SpecError:
        return None


def save(identity: str, spec: SignInSpec, secret: dict[str, str], *, login: str | None, source: str,
         scope: str = "user", workspace: str | None = None, response: dict[str, Any] | None = None,
         client_id: str | None = None, event: str | None = None) -> None:
    """Keep a sign-in; ``event`` notes it in the sign-in activity (``signed_in``, ``login_changed``)."""
    if source not in SOURCES:
        raise AccountError(f"Unknown sign-in source {source!r}.")
    if scope not in SCOPES or (scope == "session" and not workspace):
        raise AccountError("A sign-in is kept for every session, or for the current session only.")
    ws = workspace if scope == "session" else None
    record: dict[str, Any] = {"secret": secret, "login": login, "source": source, "scope": scope,
                              "saved_at": time.time(), **({"workspace": ws} if ws else {})}
    if not spec.verified:
        record["spec"] = spec.stored()
    if response and response.get("refresh_token"):
        record.update(refresh=response["refresh_token"], client_id=client_id)
    if response and isinstance(response.get("expires_in"), (int, float)):
        record["expires_at"] = time.time() + float(response["expires_in"])
    with _lock:
        _vault().store(identity, _key(spec.id, ws), record)
        if not spec.verified or ws:
            _set_index(identity, [*_index(identity), (spec.id, ws)])
    if event:
        activity.record(event, spec, workspace=ws, how=source, scope=scope, account=login,
                        read=spec.local.describe() if source == "local" and spec.local else None)


def sign_out(identity: str, spec_id: str, workspace: str | None = None, *, reason: str | None = None) -> None:
    """Forget the sign-in that applies in a session (one kept for that session, else the one for every session); a
    service that is not built in is forgotten with it."""
    vault = _vault(required=False)
    if not vault:
        return
    spec = spec_of(identity, spec_id, workspace)
    with _lock:
        ws = workspace if workspace and _read_one(identity, spec_id, workspace) else None
        existed = bool(vault.retrieve(identity, _key(spec_id, ws)))
        vault.delete(identity, _key(spec_id, ws))
        _set_index(identity, [entry for entry in _index(identity) if entry != (spec_id, ws)])
    if spec and existed:
        activity.record("signed_out", spec, workspace=ws, reason=reason)


def sign_in_with_token(identity: str, spec_id: str, token: str, *, scope: str = "user",
                       workspace: str | None = None) -> str:
    """Keep a token pasted for a built-in, once the provider names its account. Returns the account."""
    spec = builtin(spec_id)
    try:
        secret = check_secret(spec, {"token": token})
    except SpecError as exc:
        raise AccountError(str(exc)) from None
    login = account_of(spec, secret["token"])
    if not login:
        raise AccountError(f"{spec.name} did not accept that token.")
    save(identity, spec, secret, login=login, source="token", scope=scope, workspace=workspace, event="signed_in")
    return login


def reuse_local(identity: str, spec: SignInSpec | str, *, scope: str = "user", workspace: str | None = None,
                transport=None) -> str | None:
    """Sign in with this computer's own login: a built-in's, by its id, or as a spec the user confirmed reads it (its
    ``check`` URL, if any, tried first). Returns the account, when there is one."""
    from data_formulator.accounts.fetch import probe

    spec = builtin(spec) if isinstance(spec, str) else spec
    if spec.local_token:
        found = local_login(spec)
        if not found:
            raise AccountError(f"This computer has no {spec.name} login to use. Sign in instead.")
        secret, login = found["secret"], found["login"]
    else:
        if not spec.local:
            raise AccountError(f"The {spec.name} sign-in reads no login on this computer.")
        secret = _read_spec_local(spec)
        if not secret:
            raise AccountError(f"No key found at {spec.local.describe()} on this computer. Paste one instead.")
        if spec.check:
            problem = probe(spec, secret, transport=transport)
            if problem:
                raise AccountError(problem)
        login = secret.get("username")
    save(identity, spec, secret, login=login, source="local", scope=scope, workspace=workspace, event="signed_in")
    return login


def save_custom(identity: str, raw_spec: Any, secret: dict[str, Any], *, scope: str = "user",
                workspace: str | None = None, transport=None) -> SignInSpec:
    """Keep a key for a service that is not built in, with the spec the user confirmed. Its ``check`` URL, if any,
    is tried first: a key the service refuses is not kept."""
    from data_formulator.accounts.fetch import probe

    try:
        spec = validate_spec(raw_spec)
        cleaned = check_secret(spec, secret or {})
    except SpecError as exc:
        raise AccountError(str(exc)) from None
    if spec.check:
        problem = probe(spec, cleaned, transport=transport)
        if problem:
            raise AccountError(problem)
    save(identity, spec, cleaned, login=cleaned.get("username"), source="token", scope=scope, workspace=workspace,
         event="signed_in")
    return spec


def _follow_local(identity: str, spec: SignInSpec, record: dict[str, Any], *, using: bool) -> dict[str, Any]:
    """A sign-in that reuses this computer's login follows it: a new login replaces the secret. A built-in's login is
    looked at whenever the sign-in is shown or used, and logging out there (``hf auth logout``) signs out here too. A
    spec's read runs only when the key is about to be used (``using``): one that fails leaves it unused this time,
    and kept (the user removes it in Tools)."""
    if record.get("source") != "local":
        return record
    workspace = record.get("workspace") if record.get("scope") == "session" else None
    kept = {"scope": "session" if workspace else "user", "workspace": workspace}
    if spec.local_token:
        token = spec.local_token()
        if not token:
            sign_out(identity, spec.id, workspace, reason="logged out on this computer")
            return {}
        if token != _secret(record).get("token"):
            login = account_of(spec, token)
            if login:
                save(identity, spec, {"token": token}, login=login, source="local", event="login_changed", **kept)
                return _read_one(identity, spec.id, workspace)
        return record
    if not using:
        return record
    latest = _read_spec_local(spec)
    if not latest:
        activity.record("login_unreadable", spec, workspace=workspace, read=spec.local.describe() if spec.local else None)
        return {}
    if latest != _secret(record):
        save(identity, spec, latest, login=latest.get("username"), source="local", event="login_changed", **kept)
        return _read_one(identity, spec.id, workspace)
    return record


def _renew(identity: str, spec: SignInSpec, record: dict[str, Any]) -> dict[str, Any]:
    from data_formulator.auth.github_device_flow import auth_request

    flow = device_flow(spec)
    try:
        result = auth_request(flow.provider, flow.provider.token_url, {
            "grant_type": "refresh_token", "refresh_token": record["refresh"], "client_id": record.get("client_id")})
    except Exception:  # noqa: BLE001 - renewing is best effort; the provider then refuses the old token
        logger.info("Could not renew the %s sign-in", spec.id, exc_info=True)
        return record
    renewed = result.get("access_token")
    if not isinstance(renewed, str) or not renewed:
        return record
    save(identity, spec, {"token": renewed}, login=record.get("login"), source="device",
         scope=record.get("scope", "user"), workspace=record.get("workspace"),
         response={**result, "refresh_token": result.get("refresh_token") or record["refresh"]},
         client_id=record.get("client_id"))
    return _read(identity, spec.id, record.get("workspace"))


def credential(identity: str, spec_id: str, workspace: str | None) -> tuple[SignInSpec, dict[str, str], str | None] | None:
    """The spec, current secret and account to act as the user with, in this session; None when not signed in."""
    spec = spec_of(identity, spec_id, workspace)
    if spec is None:
        return None
    record = _follow_local(identity, spec, _read(identity, spec.id, workspace), using=True)
    if not _secret(record):
        return None
    expires_at = record.get("expires_at")
    if record.get("refresh") and expires_at and expires_at <= time.time() + REFRESH_MARGIN:
        record = _renew(identity, spec, record)
    return spec, _secret(record), record.get("login")


def spec_for_host(identity: str, host: str, workspace: str | None = None) -> SignInSpec | None:
    """The built-in or saved spec whose hosts include ``host`` (a built-in first), signed in or not."""
    for spec_id in [*BUILTIN, *_ids_for(identity, workspace)]:
        spec = spec_of(identity, spec_id, workspace)
        if spec and host in spec.send_to:
            return spec
    return None


def _hint(secret: dict[str, str]) -> str | None:
    value = secret.get("key") or secret.get("token") or ""
    return f"…{value[-4:]}" if len(value) >= 12 else None


def state(identity: str, spec_id: str, workspace: str | None = None) -> dict[str, Any]:
    """What the app shows about a sign-in: never the secret."""
    spec = spec_of(identity, spec_id, workspace)
    if spec is None:
        raise AccountError(f"No sign-in named {spec_id!r}.")
    record = _follow_local(identity, spec, _read(identity, spec.id, workspace), using=False)
    signed_in = bool(_secret(record))
    # A built-in's login is looked for; a spec's is read only once the user chooses it.
    found = None if signed_in or not spec.local_token else local_login(spec)
    methods = [method for method in spec.methods if method != "reuse" or found or spec.local]
    return {**spec.public(), "methods": methods, "signed_in": signed_in,
            "login": record.get("login") if signed_in else None,
            "secret_hint": _hint(_secret(record)) if signed_in else None,
            "source": record.get("source") if signed_in else None,
            "scope": record.get("scope", "user") if signed_in else None,
            "reusable_login": found["login"] if found else None}


def all_states(identity: str, workspace: str | None = None) -> list[dict[str, Any]]:
    """Built-in sign-ins, then the user's own: those for every session and those for this one."""
    states = [state(identity, spec_id, workspace) for spec_id in BUILTIN]
    for spec_id in _ids_for(identity, workspace):
        if spec_id not in BUILTIN and spec_of(identity, spec_id, workspace):
            states.append(state(identity, spec_id, workspace))
    return states
