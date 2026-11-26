# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""What every browser driver offers the browser service."""

from __future__ import annotations

from typing import Any


class BrowserError(Exception):
    """A browser operation failed; ``code`` lets the service and the UI say what to fix."""

    def __init__(self, message: str, code: str = "error") -> None:
        super().__init__(message)
        self.code = code


def step(name: str, ok: bool | None, detail: str = "") -> dict[str, Any]:
    """One availability check: ``ok`` is None when it could not be checked yet."""
    return {"step": name, "ok": ok, **({"detail": detail} if detail else {})}


class BrowserDriver:
    """Opens pages in a window of its own and runs JavaScript in them. Tabs are driver handles."""

    label = "Browser"
    # Whether pages see the user's own sign-ins (their browser profile) or a profile of Data Formulator's.
    uses_user_profile = False
    # Safari addresses tabs by position, so closing one renumbers those after it.
    positional_tabs = False

    def probe(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def open(self, url: str, tab: Any = None, *, selector: str | None = None, timeout: float = 30,
             settle: float = 2) -> dict[str, Any]:
        """Load ``url`` (in ``tab``, or a new tab) and wait for it; returns the tab handle, url and title."""
        raise NotImplementedError

    def wait(self, tab: Any, *, selector: str | None = None, timeout: float = 30, settle: float = 2) -> dict[str, Any]:
        raise NotImplementedError

    def evaluate(self, tab: Any, body: str, *, timeout: float = 30) -> dict[str, Any]:
        """Run an async function body in the page; returns ``{"value", "url", "title"}``."""
        raise NotImplementedError

    def info(self, tab: Any) -> dict[str, Any]:
        raise NotImplementedError

    def list_tabs(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def focus(self, tab: Any) -> None:
        raise NotImplementedError

    def close(self, tab: Any) -> None:
        raise NotImplementedError

    def shutdown(self) -> None:
        """Release the driver's resources (a launched browser)."""
