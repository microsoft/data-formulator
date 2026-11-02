# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Connections to MCP servers, kept open on one background event loop.

The MCP client is asynchronous and each session must be opened and closed by the same task, while
Flask handles requests on threads. A daemon thread runs an event loop; every (user, server,
definition) gets a lifecycle task that opens the transport and session, waits until it is closed or
idle, and tears them down. Requests from Flask threads are coroutines submitted to that loop.

OAuth uses the SDK's provider with tokens in the credential vault. Signing in only happens from the
settings view (``interactive``): the provider's authorization URL is handed back to the browser,
and the callback route completes the flow. During an agent run an expired sign-in fails with a
message asking the user to sign in again.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import tempfile
import sys
import threading
import time
from contextlib import AsyncExitStack
from typing import Any
from urllib.parse import parse_qs, urlsplit

from data_formulator.mcp_servers import config as mcp_config

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT = 60.0
CALL_TIMEOUT = 300.0
IDLE_SECONDS = 600.0
OAUTH_WAIT_SECONDS = 600.0


class McpError(RuntimeError):
    pass


class SignInRequired(McpError):
    pass


class AccessRefused(McpError):
    """The server answered 401 while connecting: it needs a key or a sign-in."""


def _status_message(status: int) -> str:
    if status in (401, 403):
        return f"The MCP server refused access (HTTP {status}). Check the server's sign-in settings."
    if status in (404, 405):
        return (f"No MCP endpoint at this URL (HTTP {status}). Check the URL; older servers that only speak SSE "
                "need the SSE transport.")
    return f"The MCP server answered HTTP {status}."


def error_message(exc: BaseException, http_status: int | None = None) -> str:
    """The innermost useful message from (possibly nested) exception groups."""
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    if isinstance(exc, McpError):
        return str(exc)
    if http_status:
        return _status_message(http_status)
    if type(exc).__name__ in ("ConnectError", "ConnectTimeout"):
        return "Could not reach the MCP server. Check the URL and that the server is running."
    if isinstance(exc, FileNotFoundError) and exc.filename:
        return f"Command not found: {exc.filename}. Install it, or give its full path."
    if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
        return "The MCP server did not respond in time."
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if status:
        return _status_message(status)
    text = str(exc).strip() or type(exc).__name__
    return text[:1000]


def _unwrap(exc: BaseException) -> BaseException:
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return exc


# -- OAuth -----------------------------------------------------------------------------------------

class _VaultTokenStorage:
    """``TokenStorage`` backed by the credential vault entry ``mcp:<server id>``."""

    def __init__(self, identity: str, server: dict[str, Any], redirect_uri: str | None) -> None:
        self.identity, self.server, self.redirect_uri = identity, server, redirect_uri

    def _secrets(self) -> dict[str, Any]:
        return mcp_config.read_secrets(self.identity, self.server["id"])

    async def get_tokens(self):
        from mcp.shared.auth import OAuthToken

        tokens = self._secrets().get("tokens")
        return OAuthToken.model_validate(tokens) if tokens else None

    async def set_tokens(self, tokens) -> None:
        data = tokens.model_dump(mode="json", exclude_none=True)
        mcp_config.update_secrets(self.identity, self.server["id"], lambda secrets: secrets.__setitem__("tokens", data))

    async def get_client_info(self):
        from mcp.shared.auth import OAuthClientInformationFull

        secrets = self._secrets()
        auth = self.server.get("auth", {})
        info = secrets.get("client_info")
        if info and not auth.get("client_id"):
            client = OAuthClientInformationFull.model_validate(info)
            # A client registered for another address (the app moved ports) cannot finish sign-in here.
            if self.redirect_uri is None or self.redirect_uri in {str(uri) for uri in client.redirect_uris or []}:
                return client
            return None
        if auth.get("client_id"):
            secret = secrets.get("client_secret")
            return OAuthClientInformationFull(
                client_id=auth["client_id"], client_secret=secret,
                redirect_uris=[self.redirect_uri or "http://localhost/api/mcp/oauth/callback"],
                token_endpoint_auth_method="client_secret_post" if secret else "none",
                **({"scope": auth["scope"]} if auth.get("scope") else {}))
        return None

    async def set_client_info(self, client_info) -> None:
        if self.server.get("auth", {}).get("client_id"):
            return
        data = client_info.model_dump(mode="json", exclude_none=True)
        mcp_config.update_secrets(self.identity, self.server["id"],
                                  lambda secrets: secrets.__setitem__("client_info", data))


class _PendingSignIns:
    """Authorization flows waiting for the browser to return to the callback route, keyed by ``state``."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: dict[str, tuple[asyncio.Future, float, str]] = {}

    def add(self, state: str, future: asyncio.Future, server_id: str) -> None:
        with self._lock:
            now = time.monotonic()
            self._pending = {key: value for key, value in self._pending.items() if value[1] > now}
            self._pending[state] = (future, now + OAUTH_WAIT_SECONDS, server_id)

    def resolve(self, state: str, *, code: str | None, error: str | None) -> str | None:
        """Hand the callback's result to the waiting flow; returns the server id, or None if unknown."""
        with self._lock:
            entry = self._pending.pop(state, None)
        if entry is None or entry[1] <= time.monotonic():
            return None
        future, _, server_id = entry
        loop = future.get_loop()

        def finish() -> None:
            if future.done():
                return
            if code:
                future.set_result(code)
            else:
                future.set_exception(McpError(f"Sign-in was not completed: {error or 'no code returned'}."))

        loop.call_soon_threadsafe(finish)
        return server_id


# -- connections -----------------------------------------------------------------------------------

def _definition_key(server: dict[str, Any], secrets: dict[str, Any]) -> str:
    material = {key: server.get(key) for key in ("transport", "url", "command", "args", "cwd", "auth")}
    material["secrets"] = {key: secrets.get(key) for key in ("header_value", "env", "client_secret")}
    return hashlib.sha256(json.dumps(material, sort_keys=True, default=str).encode()).hexdigest()[:16]


class _Connection:
    def __init__(self, hub: "McpHub", key: tuple[str, str, str], identity: str, server: dict[str, Any],
                 redirect_uri: str | None, interactive: bool) -> None:
        self.hub, self.key, self.identity, self.server = hub, key, identity, server
        self.redirect_uri, self.interactive = redirect_uri, interactive
        loop = asyncio.get_running_loop()
        self.ready: asyncio.Future = loop.create_future()
        self.ready.add_done_callback(lambda future: future.cancelled() or future.exception())
        self.authorize: asyncio.Future = loop.create_future()
        self.closing = asyncio.Event()
        self.session = None
        self.instructions: str | None = None
        self.last_used = time.monotonic()
        self.errlog = None
        self.http_status: int | None = None
        self.task = loop.create_task(self._lifecycle())

    def _watch(self, client):
        """Remember the last failed HTTP status: the MCP client reports most of them only as a generic error."""
        async def hook(response) -> None:
            if response.status_code >= 400:
                self.http_status = response.status_code
        client.event_hooks["response"].append(hook)
        return client

    def stderr_tail(self) -> str:
        if self.errlog is None:
            return ""
        try:
            self.errlog.flush()
            self.errlog.seek(0)
            return self.errlog.read()[-1500:].strip()
        except (OSError, ValueError):
            return ""

    async def _redirect(self, url: str) -> None:
        if not self.interactive:
            raise SignInRequired(f"Sign in to {self.server['name']} again in MCP server settings.")
        state = (parse_qs(urlsplit(url).query).get("state") or [""])[0]
        future = asyncio.get_running_loop().create_future()
        self.hub.sign_ins.add(state, future, self.server["id"])
        self._code_future, self._state = future, state
        if not self.authorize.done():
            self.authorize.set_result(url)

    async def _callback(self):
        from mcp.shared.auth import AuthorizationCodeResult

        code = await asyncio.wait_for(self._code_future, OAUTH_WAIT_SECONDS)
        return AuthorizationCodeResult(code=code, state=self._state)

    def _oauth(self):
        from mcp.client.auth.oauth2 import OAuthClientProvider
        from mcp.shared.auth import OAuthClientMetadata

        auth = self.server.get("auth", {})
        redirect = self.redirect_uri or "http://localhost/api/mcp/oauth/callback"
        metadata = OAuthClientMetadata(
            client_name="Data Formulator", redirect_uris=[redirect],
            grant_types=["authorization_code", "refresh_token"], response_types=["code"],
            token_endpoint_auth_method="none", **({"scope": auth["scope"]} if auth.get("scope") else {}))
        return OAuthClientProvider(
            server_url=self.server["url"], client_metadata=metadata,
            storage=_VaultTokenStorage(self.identity, self.server, self.redirect_uri),
            redirect_handler=self._redirect, callback_handler=self._callback)

    async def _open(self, stack: AsyncExitStack):
        from mcp import ClientSession
        from mcp.types import Implementation

        server = self.server
        secrets = mcp_config.read_secrets(self.identity, server["id"])
        if server["transport"] == "stdio":
            from mcp.client.stdio import StdioServerParameters, stdio_client

            self.errlog = tempfile.TemporaryFile("w+", encoding="utf-8", errors="replace")
            # A tool pack runs with this Data Formulator's own Python, wherever it is installed now.
            command = sys.executable if server.get("pack") else server["command"]
            parameters = StdioServerParameters(command=command, args=server.get("args", []),
                                               env=secrets.get("env") or None, cwd=server.get("cwd"))
            streams = await stack.enter_async_context(stdio_client(parameters, errlog=self.errlog))
        else:
            from mcp.shared._httpx_utils import create_mcp_http_client

            auth = server.get("auth", {})
            headers = {}
            if auth.get("type") == "header":
                if not secrets.get("header_value"):
                    raise McpError(f"Add the {auth.get('header', 'Authorization')} value for {server['name']} in MCP server settings.")
                headers[auth.get("header", "Authorization")] = secrets["header_value"]
            provider = self._oauth() if auth.get("type") == "oauth" else None
            if server["transport"] == "sse":
                from mcp.client.sse import sse_client

                def factory(**kwargs):
                    return self._watch(create_mcp_http_client(**kwargs))

                streams = await stack.enter_async_context(sse_client(
                    server["url"], headers=headers or None, timeout=30, auth=provider, httpx_client_factory=factory))
            else:
                import httpx2
                from mcp.client.streamable_http import streamable_http_client

                client = await stack.enter_async_context(self._watch(create_mcp_http_client(
                    headers=headers or None, timeout=httpx2.Timeout(30, read=CALL_TIMEOUT), auth=provider)))
                streams = await stack.enter_async_context(streamable_http_client(server["url"], http_client=client))
        read, write = streams[0], streams[1]
        session = await stack.enter_async_context(ClientSession(
            read, write, read_timeout_seconds=CALL_TIMEOUT,
            client_info=Implementation(name="data-formulator", version="1")))
        result = await session.initialize()
        return session, getattr(result, "instructions", None)

    async def _lifecycle(self) -> None:
        try:
            async with AsyncExitStack() as stack:
                self.session, self.instructions = await self._open(stack)
                if not self.ready.done():
                    self.ready.set_result(True)
                while not self.closing.is_set():
                    try:
                        await asyncio.wait_for(self.closing.wait(), 30)
                    except asyncio.TimeoutError:
                        if time.monotonic() - self.last_used > IDLE_SECONDS:
                            self.closing.set()
        except BaseException as exc:  # noqa: BLE001 - transports raise exception groups and cancellations
            inner = _unwrap(exc)
            message = error_message(inner, None if self.ready.done() else self.http_status)
            tail = self.stderr_tail()
            if tail and not isinstance(inner, McpError):
                message = f"{message}\nServer output:\n{tail}"
            if not self.ready.done():
                self.ready.set_exception((AccessRefused if self.http_status == 401 else McpError)(message))
            elif not isinstance(inner, asyncio.CancelledError):
                logger.info("MCP server %s disconnected: %s", self.server.get("id"), message)
        finally:
            self.session = None
            if self.errlog is not None:
                self.errlog.close()
            self.hub._forget(self)
            if not self.ready.done():
                self.ready.set_exception(McpError("The MCP connection closed."))
            if not self.authorize.done():
                self.authorize.cancel()


class McpHub:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._start_lock = threading.Lock()
        self._connections: dict[tuple[str, str, str], _Connection] = {}
        self.sign_ins = _PendingSignIns()

    # -- loop plumbing --

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        with self._start_lock:
            if self._loop is None or not self._thread or not self._thread.is_alive():
                loop = asyncio.new_event_loop()
                thread = threading.Thread(target=loop.run_forever, name="mcp-hub", daemon=True)
                thread.start()
                self._loop, self._thread = loop, thread
            return self._loop

    def _run(self, coroutine, timeout: float | None, cancel: threading.Event | None = None):
        """Run a coroutine on the hub loop from a Flask thread; honours ``cancel`` and ``timeout``."""
        future = asyncio.run_coroutine_threadsafe(coroutine, self._ensure_loop())
        deadline = None if timeout is None else time.monotonic() + timeout
        try:
            while True:
                wait = 0.25 if cancel is not None else None
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise McpError("The MCP server did not respond in time.")
                    wait = remaining if wait is None else min(wait, remaining)
                try:
                    return future.result(wait)
                except TimeoutError:
                    if cancel is not None and cancel.is_set():
                        raise McpError("Stopped before the MCP server answered.") from None
        finally:
            if not future.done():
                future.cancel()

    def _forget(self, connection: _Connection) -> None:
        if self._connections.get(connection.key) is connection:
            del self._connections[connection.key]

    async def _connection(self, identity: str, server: dict[str, Any], *, redirect_uri: str | None,
                          interactive: bool) -> _Connection:
        secrets = mcp_config.read_secrets(identity, server["id"])
        key = (identity, server["id"], _definition_key(server, secrets))
        for other_key, other in list(self._connections.items()):
            if other_key[:2] == key[:2] and other_key != key:
                other.closing.set()
        connection = self._connections.get(key)
        if connection is not None and connection.closing.is_set():
            # Shutting down: its session is about to close, so never hand it out again.
            self._forget(connection)
            connection = None
        if connection is None or connection.ready.done() and connection.session is None:
            connection = _Connection(self, key, identity, server, redirect_uri, interactive)
            self._connections[key] = connection
        connection.last_used = time.monotonic()
        return connection

    # -- operations (run on the loop) --

    async def _list_tools(self, session) -> list[Any]:
        from mcp.types import PaginatedRequestParams

        tools, cursor = [], None
        for _ in range(50):
            page = await session.list_tools(params=PaginatedRequestParams(cursor=cursor) if cursor else None)
            tools.extend(page.tools)
            cursor = getattr(page, "next_cursor", None)
            if not cursor:
                break
        return tools

    async def _connect(self, identity: str, server: dict[str, Any], redirect_uri: str | None,
                       resume: bool) -> dict[str, Any]:
        if resume and not any(key[:2] == (identity, server["id"]) for key in self._connections):
            raise McpError("The sign-in expired. Connect to the server again.")
        connection = await self._connection(identity, server, redirect_uri=redirect_uri, interactive=True)
        if not resume and not connection.ready.done() and connection.authorize.done():
            # A sign-in the user left unfinished: start over with a fresh authorization URL.
            connection.closing.set()
            connection.task.cancel()
            self._forget(connection)
            connection = await self._connection(identity, server, redirect_uri=redirect_uri, interactive=True)
        waiting = {connection.ready} if resume else {connection.ready, connection.authorize}
        await asyncio.wait(waiting, timeout=OAUTH_WAIT_SECONDS if resume else CONNECT_TIMEOUT,
                           return_when=asyncio.FIRST_COMPLETED)
        if connection.ready.done():
            connection.ready.result()
            tools = await asyncio.wait_for(self._list_tools(connection.session), CONNECT_TIMEOUT)
            return {"status": "connected", "tools": tools, "instructions": connection.instructions}
        if connection.authorize.done() and not connection.authorize.cancelled():
            return {"status": "authorize", "url": connection.authorize.result()}
        connection.closing.set()
        raise McpError("The MCP server did not respond in time.")

    async def _await_ready(self, identity: str, server: dict[str, Any]) -> _Connection:
        connection = await self._connection(identity, server, redirect_uri=None, interactive=False)
        await asyncio.wait_for(asyncio.shield(connection.ready), CONNECT_TIMEOUT)
        if connection.session is None:
            raise McpError("The MCP connection closed.")
        return connection

    async def _status(self, identity: str, server: dict[str, Any]) -> dict[str, Any]:
        connection = await self._await_ready(identity, server)
        tools = await asyncio.wait_for(self._list_tools(connection.session), CONNECT_TIMEOUT)
        return {"status": "connected", "tools": tools, "instructions": connection.instructions}

    async def _call(self, identity: str, server: dict[str, Any], tool: str, arguments: dict[str, Any],
                    timeout: float) -> Any:
        connection = await self._await_ready(identity, server)
        live = await asyncio.wait_for(self._list_tools(connection.session), CONNECT_TIMEOUT)
        current = next((candidate for candidate in live if candidate.name == tool), None)
        if current is None:
            raise McpError(f"{server['name']} no longer offers the tool {tool}.")
        if not mcp_config.tool_is_current(server, current):
            def note(stored: dict[str, Any]) -> None:
                mcp_config.merge_tools(stored, live, stored.get("instructions"))
            mcp_config.update_server(server["id"], note)
            raise McpError(f"{server['name']} changed the tool {tool} since you approved it. "
                           "Review the change in MCP server settings before it can be used again.")
        connection.last_used = time.monotonic()
        result = await connection.session.call_tool(tool, arguments, read_timeout_seconds=timeout)
        connection.last_used = time.monotonic()
        return result

    async def _close(self, server_id: str | None) -> None:
        closing = []
        for key, connection in list(self._connections.items()):
            if server_id is None or key[1] == server_id:
                connection.closing.set()
                self._forget(connection)
                closing.append(connection.task)
        if closing:
            await asyncio.wait(closing, timeout=5)

    # -- thread-safe API --

    def connect(self, identity: str, server: dict[str, Any], *, redirect_uri: str | None) -> dict[str, Any]:
        """Connect from the settings view. Returns tools, or an authorization URL to open."""
        return self._run(self._connect(identity, server, redirect_uri, False), CONNECT_TIMEOUT * 2 + 5)

    def finish_sign_in(self, identity: str, server: dict[str, Any]) -> dict[str, Any]:
        """After the OAuth callback: wait for the pending connection to finish and list its tools."""
        return self._run(self._connect(identity, server, None, True), CONNECT_TIMEOUT * 2 + 5)

    def refresh(self, identity: str, server: dict[str, Any]) -> dict[str, Any]:
        return self._run(self._status(identity, server), CONNECT_TIMEOUT * 2 + 5)

    def call_tool(self, identity: str, server: dict[str, Any], tool: str, arguments: dict[str, Any], *,
                  timeout: float = CALL_TIMEOUT, cancel: threading.Event | None = None) -> Any:
        return self._run(self._call(identity, server, tool, arguments, timeout),
                         timeout + CONNECT_TIMEOUT * 2 + 5, cancel)

    def close(self, server_id: str | None = None) -> None:
        """Disconnect (all, or one server's) connections and wait briefly for them to shut down."""
        if self._loop is not None:
            try:
                asyncio.run_coroutine_threadsafe(self._close(server_id), self._loop).result(10)
            except Exception:  # noqa: BLE001 - shutdown is best effort
                logger.debug("MCP close did not finish cleanly", exc_info=True)


_hub: McpHub | None = None
_hub_lock = threading.Lock()


def get_hub() -> McpHub:
    global _hub
    with _hub_lock:
        if _hub is None:
            _hub = McpHub()
        return _hub
