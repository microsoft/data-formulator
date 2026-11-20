# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Share sessions through Magic Wormhole (design-docs/71).

The sender gets a short one-time code (``7-guitarist-revenge``); whoever enters
it receives the session as a new session of their own. The archive is the same
cleaned zip a download produces (:mod:`data_formulator.datalake.session_archive`),
end-to-end encrypted between the two machines; the public relays only see
ciphertext.

Transfers speak the file protocol of ``wormhole send`` / ``wormhole receive``,
so the command-line tool interoperates: ``wormhole receive <code>`` saves the
zip, and a session zip sent with ``wormhole send`` can be received in the app.

Twisted runs in one daemon thread. Requests start transfers and read their
progress from an in-memory registry; transfers outlive the request (and the
dialog that started them) and stay listed until the user dismisses them.
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import re
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

# The command-line tool's application id, so either end can be `wormhole send/receive`.
APPID = "lothar.com/wormhole/text-or-file-xfer"
RELAY_URL = os.environ.get("DF_WORMHOLE_RELAY_URL", "ws://relay.magic-wormhole.io:4000/v1")
TRANSIT_RELAY = os.environ.get("DF_WORMHOLE_TRANSIT_RELAY", "tcp:transit.magic-wormhole.io:4001")
CODE_WORDS = 2
MAX_RECEIVE_BYTES = 2 * 1024 * 1024 * 1024
CODE_TIMEOUT_SECONDS = 30
SEND_WAIT_SECONDS = 60 * 60
RECEIVE_WAIT_SECONDS = 2 * 60
MAX_TRANSFERS_PER_OWNER = 50

CODE_PATTERN = re.compile(r"^[0-9]+(-[a-z0-9]+)+$")

ACTIVE_STATUSES = frozenset(["connecting", "waiting", "transferring", "importing"])

Importer = Callable[[Path, str], tuple[str, str]]


class WormholeUnavailable(RuntimeError):
    pass


@dataclass
class Transfer:
    id: str
    owner: str
    direction: str  # "send" | "receive"
    status: str = "connecting"  # connecting | waiting | transferring | importing | done | failed | cancelled
    display_name: str = ""
    code: str = ""
    workspace_id: str = ""
    total_bytes: int = 0
    transferred_bytes: int = 0
    error: str = ""
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    _deferred: Any = field(default=None, repr=False)
    _cancelled: bool = field(default=False, repr=False)
    _timed_out: bool = field(default=False, repr=False)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id, "direction": self.direction, "status": self.status,
            "display_name": self.display_name, "code": self.code, "workspace_id": self.workspace_id,
            "total_bytes": self.total_bytes, "transferred_bytes": self.transferred_bytes,
            "error": self.error, "created_at": self.created_at, "finished_at": self.finished_at,
        }


_transfers: dict[str, Transfer] = {}
_lock = threading.Lock()
_reactor_thread: threading.Thread | None = None


def available() -> bool:
    import importlib.util
    return importlib.util.find_spec("wormhole") is not None


def enabled() -> bool:
    """Wormhole sharing runs only where the server is the user's own computer (local mode, local sessions)."""
    from data_formulator.auth.identity import is_local_mode
    from data_formulator.workspace_factory import _get_backend
    return is_local_mode() and _get_backend() == "local" and available()


def new_workspace_id() -> str:
    """A session id in the format the app generates (``session_<date>_<time>_<4 hex>``)."""
    return f"session_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:4]}"


def normalize_code(code: str) -> str:
    """The code as typed, with spaces between words accepted; raises ValueError when it isn't one."""
    normalized = "-".join(str(code or "").strip().lower().split())
    if len(normalized) > 100 or not CODE_PATTERN.match(normalized):
        raise ValueError("Enter a wormhole code like 7-guitarist-revenge.")
    return normalized


def list_transfers(owner: str) -> list[dict[str, Any]]:
    with _lock:
        return [t.public() for t in sorted(_transfers.values(), key=lambda t: t.created_at) if t.owner == owner]


def get_transfer(owner: str, transfer_id: str) -> dict[str, Any] | None:
    with _lock:
        transfer = _transfers.get(transfer_id)
        return transfer.public() if transfer and transfer.owner == owner else None


def cancel(owner: str, transfer_id: str) -> bool:
    with _lock:
        transfer = _transfers.get(transfer_id)
        if not transfer or transfer.owner != owner:
            return False
        if transfer.status not in ACTIVE_STATUSES or transfer.status == "importing":
            return True
        transfer._cancelled = True
        deferred = transfer._deferred
    if deferred is not None:
        _reactor().callFromThread(_cancel_deferred, deferred)
    return True


def dismiss(owner: str, transfer_id: str) -> bool:
    """Forget a finished transfer (an active one must be cancelled first)."""
    with _lock:
        transfer = _transfers.get(transfer_id)
        if not transfer or transfer.owner != owner:
            return False
        if transfer.status in ACTIVE_STATUSES:
            return False
        del _transfers[transfer_id]
        return True


def start_send(owner: str, workspace_id: str, display_name: str, archive: bytes) -> dict[str, Any]:
    """Offer ``archive`` through a new wormhole; returns once the relay has given it a code."""
    transfer = _register(Transfer(id=uuid.uuid4().hex, owner=owner, direction="send", display_name=display_name,
                                  workspace_id=workspace_id, total_bytes=len(archive)))
    code_ready = threading.Event()
    _start(transfer, lambda: _send(transfer, archive, code_ready), SEND_WAIT_SECONDS)
    if not code_ready.wait(CODE_TIMEOUT_SECONDS):
        cancel(owner, transfer.id)
        _finish(transfer, "failed", "Couldn't reach the wormhole relay server.")
    return transfer.public()


def start_receive(owner: str, code: str, importer: Importer) -> dict[str, Any]:
    """Receive the session sent with ``code`` and import it with ``importer`` (run off the reactor)."""
    transfer = _register(Transfer(id=uuid.uuid4().hex, owner=owner, direction="receive", code=code))
    _start(transfer, lambda: _receive(transfer, code, importer), RECEIVE_WAIT_SECONDS)
    return transfer.public()


# ---------------------------------------------------------------------------
# Reactor plumbing
# ---------------------------------------------------------------------------

def _reactor():
    global _reactor_thread
    from twisted.internet import reactor

    with _lock:
        if _reactor_thread is None or not _reactor_thread.is_alive():
            _reactor_thread = threading.Thread(target=reactor.run, kwargs={"installSignalHandlers": False},
                                               name="wormhole-reactor", daemon=True)
            _reactor_thread.start()
    return reactor


def _register(transfer: Transfer) -> Transfer:
    if not available():
        raise WormholeUnavailable("Wormhole sharing is not installed on this server.")
    with _lock:
        mine = sorted((t for t in _transfers.values() if t.owner == transfer.owner and t.status not in ACTIVE_STATUSES),
                      key=lambda t: t.created_at)
        for old in mine[:max(0, len(mine) - MAX_TRANSFERS_PER_OWNER + 1)]:
            del _transfers[old.id]
        _transfers[transfer.id] = transfer
    return transfer


def _start(transfer: Transfer, run: Callable[[], Any], wait_seconds: float) -> None:
    reactor = _reactor()

    def begin():
        deferred = run()
        with _lock:
            transfer._deferred = deferred
            cancelled = transfer._cancelled

        def expire():
            # Only the wait for the other side times out; a transfer under way runs to the end.
            if transfer.status in ("connecting", "waiting"):
                transfer._timed_out = True
                _cancel_deferred(deferred)

        timer = reactor.callLater(wait_seconds, expire)

        def stop_timer(result):
            if timer.active():
                timer.cancel()
            return result

        deferred.addBoth(stop_timer)
        if cancelled:
            _cancel_deferred(deferred)

    reactor.callFromThread(begin)


def _cancel_deferred(deferred) -> None:
    if not deferred.called:
        deferred.cancel()


def _update(transfer: Transfer, **changes: Any) -> None:
    with _lock:
        for key, value in changes.items():
            setattr(transfer, key, value)


def _finish(transfer: Transfer, status: str, error: str = "") -> None:
    with _lock:
        if transfer.status in ACTIVE_STATUSES:
            transfer.status, transfer.error, transfer.finished_at = status, error, time.time()


def _fail(transfer: Transfer, failure: BaseException) -> None:
    from twisted.internet.defer import CancelledError
    from wormhole.errors import LonelyError, ServerConnectionError, TransferError, WelcomeError, WrongPasswordError

    if transfer._timed_out:
        message = ("No one received the session in time; send it again for a new code." if transfer.direction == "send"
                   else "No sender answered this code. Check it and that the sender is still waiting.")
        _finish(transfer, "failed", message)
    elif transfer._cancelled or isinstance(failure, (CancelledError, LonelyError)):
        _finish(transfer, "cancelled")
    elif isinstance(failure, WrongPasswordError):
        _finish(transfer, "failed", "The code doesn't match. Check it and try again.")
    elif isinstance(failure, (ServerConnectionError, WelcomeError)):
        _finish(transfer, "failed", "Couldn't reach the wormhole relay server.")
    elif isinstance(failure, TransferError):
        _finish(transfer, "failed", str(failure))
    elif isinstance(failure, _ImportFailed):
        _finish(transfer, "failed", str(failure))
    else:
        logger.warning("Wormhole %s failed", transfer.direction, exc_info=failure)
        _finish(transfer, "failed", "The transfer was interrupted.")


class _ImportFailed(Exception):
    pass


def _message(data: dict) -> bytes:
    from wormhole.util import dict_to_bytes
    return dict_to_bytes(data)


def _parse(data: bytes) -> dict:
    from wormhole.util import bytes_to_dict
    parsed = bytes_to_dict(data)
    return parsed if isinstance(parsed, dict) else {}


def _tell_peer_if_cancelled(transfer: Transfer, w) -> None:
    if transfer._cancelled:
        try:
            w.send_message(_message({"error": "transfer cancelled"}))
        except Exception:
            pass


def _close_quietly(resource) -> Any:
    from twisted.internet.defer import succeed
    try:
        result = resource.close()
    except Exception:
        return succeed(None)
    if hasattr(result, "addErrback"):
        result.addErrback(lambda _failure: None)
        return result
    return succeed(None)


def _archive_filename(display_name: str) -> str:
    stem = re.sub(r"[^\w\- ]+", "", display_name).strip()[:80] or "session"
    return f"{stem}.zip"


# ---------------------------------------------------------------------------
# The two sides
# ---------------------------------------------------------------------------

def _send(transfer: Transfer, archive: bytes, code_ready: threading.Event):
    from twisted.internet import reactor
    from twisted.internet.defer import inlineCallbacks
    from twisted.protocols.basic import FileSender
    from wormhole import create
    from wormhole.errors import TransferError
    from wormhole.transit import TransitSender

    @inlineCallbacks
    def run():
        w = create(APPID, RELAY_URL, reactor)
        pipe = None
        try:
            w.allocate_code(CODE_WORDS)
            code = yield w.get_code()
            _update(transfer, code=code, status="waiting")
            code_ready.set()
            yield w.get_unverified_key()
            yield w.get_verifier()  # raises WrongPasswordError when the receiver typed another code
            _update(transfer, status="transferring")

            # Relay only: listening for a direct connection would make desktop firewalls ask for permission.
            transit = TransitSender(TRANSIT_RELAY, no_listen=True, reactor=reactor)
            hints = yield transit.get_connection_hints()
            w.send_message(_message({"transit": {"abilities-v1": transit.get_connection_abilities(),
                                                 "hints-v1": hints}}))
            transit.set_transit_key(w.derive_key(APPID + "/transit-key", transit.TRANSIT_KEY_LENGTH))
            w.send_message(_message({"offer": {"file": {"filename": _archive_filename(transfer.display_name),
                                                        "filesize": len(archive)}}}))
            while True:
                reply = _parse((yield w.get_message()))
                if "error" in reply:
                    raise TransferError(f"The receiver declined the session: {reply['error']}")
                if "transit" in reply:
                    transit.add_connection_hints(reply["transit"].get("hints-v1", []))
                if "answer" in reply:
                    if reply["answer"].get("file_ack") != "ok":
                        raise TransferError("The receiver declined the session.")
                    break

            pipe = yield transit.connect()
            hasher = hashlib.sha256()

            def count(chunk: bytes) -> bytes:
                hasher.update(chunk)
                _update(transfer, transferred_bytes=transfer.transferred_bytes + len(chunk))
                return chunk

            if archive:
                yield FileSender().beginFileTransfer(io.BytesIO(archive), pipe, transform=count)
            ack = _parse((yield pipe.receive_record()))
            if ack.get("ack") != "ok" or ack.get("sha256", hasher.hexdigest()) != hasher.hexdigest():
                raise TransferError("The receiver didn't confirm the session arrived intact.")
            _finish(transfer, "done")
        except Exception as failure:  # every failure becomes the transfer's status
            _tell_peer_if_cancelled(transfer, w)
            _fail(transfer, failure)
        finally:
            code_ready.set()
            if pipe is not None:
                yield _close_quietly(pipe)
            yield _close_quietly(w)

    return run()


def _receive(transfer: Transfer, code: str, importer: Importer):
    from twisted.internet import reactor, threads
    from twisted.internet.defer import inlineCallbacks
    from wormhole import create
    from wormhole.errors import TransferError
    from wormhole.transit import TransitReceiver

    @inlineCallbacks
    def run():
        w = create(APPID, RELAY_URL, reactor)
        pipe = None
        transit = None
        destination = None
        try:
            w.set_code(code)
            yield w.get_unverified_key()
            yield w.get_verifier()
            while True:
                offer_message = _parse((yield w.get_message()))
                if "error" in offer_message:
                    raise TransferError(f"The sender cancelled: {offer_message['error']}")
                if "transit" in offer_message and transit is None:
                    transit = TransitReceiver(TRANSIT_RELAY, no_listen=True, reactor=reactor)
                    transit.set_transit_key(w.derive_key(APPID + "/transit-key", transit.TRANSIT_KEY_LENGTH))
                    transit.add_connection_hints(offer_message["transit"].get("hints-v1", []))
                    hints = yield transit.get_connection_hints()
                    w.send_message(_message({"transit": {"abilities-v1": transit.get_connection_abilities(),
                                                         "hints-v1": hints}}))
                if "offer" in offer_message:
                    offer = offer_message["offer"]
                    break

            offered = offer.get("file") if isinstance(offer, dict) else None
            reason = _refusal(offered, transit)
            if reason:
                w.send_message(_message({"error": reason}))
                raise TransferError(reason)
            size = int(offered["filesize"])
            name = str(offered.get("filename") or "session.zip")
            _update(transfer, status="transferring", total_bytes=size,
                    display_name=name[:-4] if name.lower().endswith(".zip") else name)
            w.send_message(_message({"answer": {"file_ack": "ok"}}))

            pipe = yield transit.connect()
            handle = tempfile.NamedTemporaryFile(prefix="df_wormhole_", suffix=".zip", delete=False)
            destination = Path(handle.name)
            hasher = hashlib.sha256()

            def progress(count: int) -> None:
                _update(transfer, transferred_bytes=transfer.transferred_bytes + count)

            with handle:
                received = yield pipe.writeToFile(handle, size, progress, hasher.update)
            if received < size:
                raise TransferError("The connection dropped before the whole session arrived.")
            pipe.send_record(_message({"ack": "ok", "sha256": hasher.hexdigest()}))
            yield _close_quietly(pipe)
            pipe = None

            _update(transfer, status="importing")
            try:
                workspace_id, display_name = yield threads.deferToThread(importer, destination, transfer.display_name)
            except ValueError as error:
                raise _ImportFailed("This isn't a Data Formulator session, or it is too large to import.") from error
            except Exception as error:
                logger.warning("Importing a received session failed", exc_info=error)
                raise _ImportFailed("The session arrived but couldn't be imported.") from error
            _update(transfer, workspace_id=workspace_id, display_name=display_name)
            _finish(transfer, "done")
        except Exception as failure:  # every failure becomes the transfer's status
            _tell_peer_if_cancelled(transfer, w)
            _fail(transfer, failure)
        finally:
            if pipe is not None:
                yield _close_quietly(pipe)
            yield _close_quietly(w)
            if destination is not None:
                destination.unlink(missing_ok=True)

    return run()


def _refusal(offered: Any, transit: Any) -> str:
    if not isinstance(offered, dict) or transit is None:
        return "Data Formulator can only receive a session file (.zip)."
    try:
        size = int(offered.get("filesize"))
    except (TypeError, ValueError):
        return "The offered file has no size."
    if size <= 0 or size > MAX_RECEIVE_BYTES:
        return "The session is too large to receive."
    if not str(offered.get("filename") or "").lower().endswith(".zip"):
        return "Data Formulator can only receive a session file (.zip)."
    return ""
