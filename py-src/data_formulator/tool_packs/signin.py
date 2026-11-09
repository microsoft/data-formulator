# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Click-to-sign-in for tool packs that act with the user's own account: GitHub and Hugging Face.

Each provider has a device flow (the user enters a short code on the provider's site), a way to name the account a
token belongs to, and an account Data Formulator may already have to reuse in one click: for GitHub, the one signed in
for GitHub Copilot models; for Hugging Face, this computer's Hugging Face login (``hf auth login``, or ``HF_TOKEN``).

A pack's token lives in its server's secrets in the credential vault, as the environment variable its ``signin`` names,
with ``signin_login`` (the account). A Hugging Face sign-in's token expires: its refresh token, client and expiry are
kept too, and ``prepare`` renews the token before the server is used; a reused local login is re-read instead, so it
follows the user's own ``hf auth login``. A changed token changes the server's environment, so the hub restarts it.
"""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import requests as http

from data_formulator.auth.github_device_flow import DeviceFlow, DeviceProvider, auth_request, github_login

logger = logging.getLogger(__name__)

# The public app (no secret) huggingface_hub's own `hf auth login` signs in to; ours can replace it via HF_TOOLS_CLIENT_ID.
HF_CLI_CLIENT_ID = "26be6b09-91c5-47da-9861-d2d2bb7a7e36"
HUGGING_FACE = DeviceProvider("Hugging Face", "https://huggingface.co/oauth/device", "https://huggingface.co/oauth/token",
                              ("https://hf.co/oauth/device", "https://huggingface.co/oauth/device"), form=True)
# Read public gated datasets the user was granted, and know who they are; nothing private, nothing written.
HF_SCOPE = "openid profile gated-repos"
REFRESH_MARGIN = 120
LOGIN_TTL = 600

_logins: dict[str, tuple[str | None, float]] = {}


def provider_of(pack_id: str) -> str:
    from data_formulator.tool_packs import PACKS

    return PACKS[pack_id]["signin"]["provider"]


def flow(pack_id: str) -> DeviceFlow:
    """The pack's device flow: our own app when one is configured; else, for now, a public one that exists already
    (the GitHub Copilot connection's, or huggingface_hub's)."""
    key = f"mcp-pack-signin:{pack_id}"
    if provider_of(pack_id) == "huggingface":
        return DeviceFlow(key, lambda: os.environ.get("HF_TOOLS_CLIENT_ID") or HF_CLI_CLIENT_ID, HF_SCOPE, HUGGING_FACE)
    from data_formulator.routes.model_endpoints import _COPILOT_CLIENT_ID

    return DeviceFlow(key, lambda: os.environ.get("GITHUB_TOOLS_CLIENT_ID") or _COPILOT_CLIENT_ID, scope="")


def hf_login(token: str) -> str | None:
    """The Hugging Face account a token belongs to, or None when Hugging Face does not accept it."""
    try:
        response = http.get("https://huggingface.co/api/whoami-v2", timeout=20, allow_redirects=False,
                            headers={"Authorization": f"Bearer {token}"})
        name = response.json().get("name") if response.status_code == 200 else None
        return name if isinstance(name, str) and name else None
    except (http.RequestException, ValueError, AttributeError):
        return None


def account(provider: str, token: str) -> str | None:
    """The account a token belongs to (remembered a few minutes: listing packs asks often)."""
    cached = _logins.get(token)
    if cached and time.time() - cached[1] < LOGIN_TTL:
        return cached[0]
    login = hf_login(token) if provider == "huggingface" else github_login(token)
    _logins[token] = (login, time.time())
    return login


def _local_hf_token() -> str | None:
    """This computer's Hugging Face login: ``HF_TOKEN``, or the token ``hf auth login`` saved."""
    try:
        from huggingface_hub import get_token
    except ImportError:
        return os.environ.get("HF_TOKEN") or None
    try:
        return get_token() or None
    except Exception:  # noqa: BLE001 - an unreadable login is no login
        return None


def reusable(provider: str, identity: str) -> dict[str, Any] | None:
    """An account Data Formulator can already use for this provider: ``{"token", "login", "source"}``, or None."""
    if provider == "huggingface":
        token = _local_hf_token()
        login = account(provider, token) if token else None
        return {"token": token, "login": login, "source": "local"} if login else None
    from data_formulator.mcp_servers.routes import _copilot_connection

    copilot = _copilot_connection(identity)
    if not copilot:
        return None
    return {"token": copilot["access_token"], "login": copilot.get("login") or "GitHub Copilot", "source": "copilot"}


def signed_in(env_name: str, stored: dict[str, Any], token: str | None, login: str | None, *,
              response: dict[str, Any] | None = None, client_id: str | None = None, source: str | None = None) -> None:
    """Keep (or, with no token, drop) a pack's sign-in in its server's secrets: the token as ``env_name``, the account,
    and what renews it (a device sign-in's refresh token, or the local login it follows)."""
    env = dict(stored.get("env") or {})
    for key in ("signin_login", "signin_refresh", "signin_expires_at", "signin_client_id", "signin_source"):
        stored.pop(key, None)
    if token:
        env[env_name] = token
        stored["signin_login"] = login
        if source:
            stored["signin_source"] = source
        if response and response.get("refresh_token"):
            stored["signin_refresh"] = response["refresh_token"]
            stored["signin_client_id"] = client_id
        if response and isinstance(response.get("expires_in"), (int, float)):
            stored["signin_expires_at"] = time.time() + float(response["expires_in"])
    else:
        env.pop(env_name, None)
    if env:
        stored["env"] = env
    else:
        stored.pop("env", None)


def prepare(identity: str, server: dict[str, Any]) -> None:
    """Before a pack's server is used: renew its sign-in when its token is about to expire, or re-read the local login
    it follows. A failure leaves the token as it is (the provider then refuses it, and the toolkit says to sign in)."""
    from data_formulator.mcp_servers import config as mcp_config
    from data_formulator.tool_packs import PACKS

    signin = (PACKS.get(server.get("pack") or "") or {}).get("signin")
    if not signin:
        return
    stored = mcp_config.read_secrets(identity, server["id"])
    env_name = signin["env"]
    current = (stored.get("env") or {}).get(env_name)
    if not current:
        return
    if stored.get("signin_source") == "local" and signin["provider"] == "huggingface":
        token = _local_hf_token()
        if token and token != current:
            login = stored.get("signin_login")
            mcp_config.update_secrets(identity, server["id"], lambda secrets: signed_in(env_name, secrets, token, login, source="local"))
        return
    expires_at = stored.get("signin_expires_at")
    if not stored.get("signin_refresh") or not expires_at or expires_at > time.time() + REFRESH_MARGIN:
        return
    try:
        result = auth_request(HUGGING_FACE, HUGGING_FACE.token_url, {
            "grant_type": "refresh_token", "refresh_token": stored["signin_refresh"], "client_id": stored.get("signin_client_id")})
    except Exception:  # noqa: BLE001 - renewing is best effort
        logger.info("Could not renew the %s sign-in for %s", signin["provider"], server["id"], exc_info=True)
        return
    token = result.get("access_token")
    if not isinstance(token, str) or not token:
        logger.info("The %s sign-in for %s could not be renewed: %s", signin["provider"], server["id"], result.get("error"))
        return
    renewed = {**result, "refresh_token": result.get("refresh_token") or stored["signin_refresh"]}
    login, client_id = stored.get("signin_login"), stored.get("signin_client_id")
    mcp_config.update_secrets(identity, server["id"],
                              lambda secrets: signed_in(env_name, secrets, token, login, response=renewed, client_id=client_id))
