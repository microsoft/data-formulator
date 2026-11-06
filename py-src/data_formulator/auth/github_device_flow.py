# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Click-to-sign-in with an OAuth device flow (RFC 8628), for connections that act with the user's own account:
GitHub (models and the GitHub toolkit) and, with its own ``DeviceProvider``, Hugging Face.

The user is shown a short code, enters it on the provider's site (github.com/login/device), and approves the app; Data
Formulator polls until the provider hands over a token. No redirect back to Data Formulator is needed, so it works in
the local app too.
Each flow lives in the credential vault under its ``flow_key`` (per identity), with its device code never leaving
the server. A poll's token exchange runs outside the lock; what it produces is committed only if the same flow is
still current (not cancelled, restarted or expired meanwhile).
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable

import requests as http
from filelock import FileLock

from data_formulator.auth.vault import get_credential_vault
from data_formulator.datalake.workspace import get_data_formulator_home
from data_formulator.errors import AppError, ErrorCode

FLOW_TTL = 600
DEVICE_URL = "https://github.com/login/device"


def connection_lock() -> FileLock:
    home = get_data_formulator_home()
    home.mkdir(parents=True, exist_ok=True)
    return FileLock(home / ".model-connections.lock", timeout=10)


def connection_vault():
    vault = get_credential_vault()
    if vault is None:
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, "Secure credential storage is unavailable")
    return vault


@dataclass(frozen=True)
class DeviceProvider:
    """Where a provider's device flow runs: its name (in messages), endpoints, the verification pages it may send
    users to, and whether it takes form fields (Hugging Face) rather than JSON (GitHub)."""
    name: str
    code_url: str
    token_url: str
    verification_urls: tuple[str, ...]
    form: bool = False


GITHUB = DeviceProvider("GitHub", "https://github.com/login/device/code", "https://github.com/login/oauth/access_token",
                        (DEVICE_URL,))


def auth_request(provider: DeviceProvider, url: str, payload: dict) -> dict:
    """POST to a provider's OAuth endpoint. An OAuth error answer (``{"error": …}``, which some providers send with
    HTTP 400) is returned for the caller to read; anything else that is not 200 fails."""
    try:
        sent = {"data": payload} if provider.form else {"json": payload}
        response = http.post(url, headers={"Accept": "application/json"}, timeout=20, allow_redirects=False, **sent)
        result = response.json() if response.status_code in (200, 400) else None
        if not isinstance(result, dict) or (response.status_code != 200 and not isinstance(result.get("error"), str)):
            raise ValueError("Invalid authorization response")
        return result
    except (http.RequestException, ValueError):
        raise AppError(ErrorCode.SERVICE_UNAVAILABLE, f"Could not contact {provider.name}. Try again.") from None


def github_auth_request(url: str, payload: dict) -> dict:
    return auth_request(GITHUB, url, payload)


def github_login(token: str) -> str | None:
    """The GitHub login a token belongs to, or None when GitHub does not accept it."""
    try:
        response = http.get("https://api.github.com/user", timeout=20, allow_redirects=False,
                            headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}"})
        login = response.json().get("login") if response.status_code == 200 else None
        return login if isinstance(login, str) and login else None
    except (http.RequestException, ValueError, AttributeError):
        return None


class DeviceFlow:
    """One kind of sign-in: its vault key, the app it signs in to, the scope it asks for, and the provider."""

    def __init__(self, flow_key: str, client_id: Callable[[], str], scope: str, provider: DeviceProvider = GITHUB) -> None:
        self.flow_key = flow_key
        self.client_id = client_id
        self.scope = scope
        self.provider = provider

    def start(self, identity: str) -> dict[str, Any]:
        vault = connection_vault()
        flow_id = secrets.token_urlsafe(32)
        client_id = self.client_id()
        with connection_lock():
            vault.store(identity, self.flow_key, {"id": flow_id, "status": "starting", "expires_at": time.time() + FLOW_TTL})
        payload = {"client_id": client_id, **({"scope": self.scope} if self.scope or self.provider is GITHUB else {})}
        result = auth_request(self.provider, self.provider.code_url, payload)
        if (not all(isinstance(result.get(field), str) and result[field] for field in ("device_code", "user_code"))
                or result.get("verification_uri") not in self.provider.verification_urls
                or not isinstance(result.get("expires_in"), int) or not 0 < result["expires_in"] <= 3600
                or not isinstance(result.get("interval", 5), int) or not 0 < result.get("interval", 5) <= 60):
            raise AppError(ErrorCode.SERVICE_UNAVAILABLE, f"Invalid {self.provider.name} authorization response. Try again.")
        interval = max(5, result.get("interval", 5))
        with connection_lock():
            current = vault.retrieve(identity, self.flow_key)
            if not current or current["id"] != flow_id:
                raise AppError(ErrorCode.INVALID_REQUEST, "Authorization was cancelled")
            vault.store(identity, self.flow_key, {
                "id": flow_id, "client_id": client_id, "status": "pending",
                "device_code": result["device_code"], "user_code": result["user_code"],
                "expires_at": time.time() + result["expires_in"],
                "interval": interval, "next_poll_at": time.time() + interval,
            })
        return {"flow_id": flow_id, "user_code": result["user_code"], "authorization_url": result["verification_uri"],
                "expires_in": result["expires_in"], "interval": interval}

    def poll(self, identity: str, flow_id: Any, exchange: Callable[[str, dict[str, Any]], Any],
             commit: Callable[[Any], None]) -> dict[str, Any]:
        """Ask the provider whether the user approved. With a token, ``exchange(token, response)`` (outside the lock;
        may raise ``AppError``; ``response`` is the whole token answer, e.g. its refresh token) makes what ``commit``
        stores, under the lock, if this flow is still the current one."""
        vault = connection_vault()
        with connection_lock():
            flow = vault.retrieve(identity, self.flow_key)
            if not flow or flow["id"] != flow_id or flow["expires_at"] <= time.time():
                raise AppError(ErrorCode.INVALID_REQUEST, "Authorization expired or was cancelled. Start again.")
            if flow["status"] != "pending" or flow["next_poll_at"] > time.time():
                return {"id": flow["id"], "status": flow["status"]}
            flow["next_poll_at"] = time.time() + max(flow["interval"], 90)
            flow["poll_id"] = secrets.token_urlsafe(16)
            vault.store(identity, self.flow_key, flow)
        made = None
        error = None
        try:
            result = auth_request(self.provider, self.provider.token_url, {
                "client_id": flow["client_id"], "device_code": flow["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            })
            if result.get("error") == "slow_down":
                flow["interval"] += 5
            elif result.get("error") == "authorization_pending":
                pass
            elif isinstance(result.get("access_token"), str) and result["access_token"]:
                made = exchange(result["access_token"], result)
                flow["status"] = "connected"
            else:
                flow["status"] = "error"
        except AppError as caught:
            flow["status"] = "error"
            error = caught
        if flow["status"] != "pending":
            flow.pop("device_code", None)
        flow["next_poll_at"] = time.time() + flow["interval"]
        with connection_lock():
            current = vault.retrieve(identity, self.flow_key)
            if (not current or current["id"] != flow["id"] or current["expires_at"] <= time.time()
                    or current.get("poll_id") != flow["poll_id"]):
                raise AppError(ErrorCode.INVALID_REQUEST, "Authorization was cancelled or expired")
            if made is not None:
                commit(made)
            vault.store(identity, self.flow_key, flow)
        if error:
            raise error
        return {"id": flow["id"], "status": flow["status"]}

    def current(self, identity: str) -> dict[str, Any] | None:
        """The flow in progress (dropping an expired one), or None."""
        vault = connection_vault()
        with connection_lock():
            flow = vault.retrieve(identity, self.flow_key)
            if flow and flow["expires_at"] <= time.time():
                vault.delete(identity, self.flow_key)
                flow = None
        return flow

    def cancel(self, identity: str, flow_id: Any) -> None:
        vault = connection_vault()
        with connection_lock():
            flow = vault.retrieve(identity, self.flow_key)
            if flow and flow["id"] == flow_id:
                vault.delete(identity, self.flow_key)


GitHubDeviceFlow = DeviceFlow
