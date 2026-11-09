# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Drive the installed Microsoft Edge (or Chrome) with a browser profile of Data Formulator's own.

The route on Windows, where browsers have no Apple Events: Playwright starts the installed browser
(no browser download) over a private pipe, with a persistent profile under Data Formulator's home.
Pages there do not see the user's everyday sign-ins; the user signs in once in this window and
the profile keeps it (on Windows, Edge signs in with the work account the device uses).

Playwright's synchronous API belongs to the thread that started it, so every call runs on one
worker thread.
"""

from __future__ import annotations

import concurrent.futures
import itertools
import json
import time
from pathlib import Path
from typing import Any, Callable

from data_formulator.browser.base import BrowserError, BrowserDriver, step

CHANNELS = {"edge": ("msedge", "Microsoft Edge"), "chrome": ("chrome", "Google Chrome")}
_TIMEOUT_MARK = "__df_timeout__"


def playwright_installed() -> bool:
    import importlib.util

    return importlib.util.find_spec("playwright") is not None


class PlaywrightDriver(BrowserDriver):
    uses_user_profile = False

    def __init__(self, key: str, profile_dir: Path) -> None:
        self.key = key
        self.channel, name = CHANNELS[key]
        self.label = f"{name} (Data Formulator profile)"
        self.profile_dir = profile_dir
        self._executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="df-browser")
        self._playwright = None
        self._context = None
        self._pages: dict[str, Any] = {}
        self._ids = itertools.count(1)

    # -- worker thread ---------------------------------------------------------------------------

    def _call(self, fn: Callable[[], Any], timeout: float) -> Any:
        future = self._executor.submit(fn)
        try:
            return future.result(timeout=timeout + 30)
        except concurrent.futures.TimeoutError as exc:
            raise BrowserError("The browser did not respond in time.", "timeout") from exc

    def _ensure(self):
        if self._context is not None:
            try:
                self._context.pages  # noqa: B018 - raises once the browser is gone
                if self._context.browser is None or self._context.browser.is_connected():
                    return self._context
            except Exception:  # noqa: BLE001
                pass
            self._reset()
        if not playwright_installed():
            raise BrowserError("Browser support is not installed (the playwright package).", "not_installed")
        from playwright.sync_api import sync_playwright

        self.profile_dir.mkdir(parents=True, exist_ok=True)
        self._playwright = sync_playwright().start()
        try:
            self._context = self._playwright.chromium.launch_persistent_context(
                str(self.profile_dir), channel=self.channel, headless=False, no_viewport=True, bypass_csp=True,
                args=["--no-first-run", "--no-default-browser-check"])
        except Exception as exc:  # noqa: BLE001 - every launch failure is reported as such
            self._reset()
            message = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
            code = "not_installed" if "executable doesn't exist" in message.lower() or "is not found" in message.lower() else "launch_failed"
            raise BrowserError(f"Could not start {self.label}: {message}", code) from exc
        self._context.on("close", lambda *_: self._reset())
        self._context.on("page", self._register)
        for page in self._context.pages:
            self._register(page)
        return self._context

    def _reset(self) -> None:
        self._pages.clear()
        context, playwright = self._context, self._playwright
        self._context = self._playwright = None
        for closer in (getattr(context, "close", None), getattr(playwright, "stop", None)):
            try:
                if closer:
                    closer()
            except Exception:  # noqa: BLE001
                pass

    def _register(self, page) -> str:
        for key, known in self._pages.items():
            if known is page:
                return key
        key = f"p{next(self._ids)}"
        self._pages[key] = page
        page.on("close", lambda *_: self._pages.pop(key, None))
        return key

    def _page(self, tab: Any):
        page = self._pages.get(str(tab))
        if page is None or page.is_closed():
            raise BrowserError("That tab was closed.", "gone")
        return page

    def _settle(self, page, deadline: float, settle: float) -> bool:
        until = min(deadline, time.monotonic() + settle)
        last, stable = -1, 0
        while time.monotonic() < until and stable < 2:
            time.sleep(0.4)
            try:
                length = page.evaluate("() => document.body ? document.body.innerText.length : 0")
            except Exception:  # noqa: BLE001 - navigating
                length = -1
            stable = stable + 1 if length == last and length > 0 else 0
            last = length
        return time.monotonic() >= deadline

    def _wait(self, page, selector: str | None, timeout: float, settle: float, deadline: float) -> dict[str, Any]:
        if selector:
            try:
                page.wait_for_selector(selector, timeout=max(1, deadline - time.monotonic()) * 1000)
            except Exception:  # noqa: BLE001 - Playwright's TimeoutError
                return {"timed_out": True, "waited_for": selector}
        return {"timed_out": self._settle(page, deadline, settle)}

    # -- driver API ------------------------------------------------------------------------------

    def probe(self) -> list[dict[str, Any]]:
        if not playwright_installed():
            return [step("installed", False, "Browser support is not installed (the playwright package)."),
                    step("launch", None), step("javascript", None)]

        def run():
            context = self._ensure()
            page = context.new_page()
            try:
                return page.evaluate("() => 6 * 7")
            finally:
                page.close()
        try:
            value = self._call(run, 60)
        except BrowserError as exc:
            if exc.code == "not_installed":
                return [step("installed", False, str(exc)), step("launch", None), step("javascript", None)]
            return [step("installed", True), step("launch", False, str(exc)), step("javascript", None)]
        return [step("installed", True), step("launch", True), step("javascript", value == 42)]

    def open(self, url: str, tab: Any = None, *, selector: str | None = None, timeout: float = 30,
             settle: float = 2) -> dict[str, Any]:
        def run():
            context = self._ensure()
            deadline = time.monotonic() + timeout
            if tab is not None and str(tab) in self._pages and not self._pages[str(tab)].is_closed():
                page, key = self._pages[str(tab)], str(tab)
            else:
                blank = next((page for page in context.pages if page.url == "about:blank" and not page.is_closed()), None)
                page = blank or context.new_page()
                key = self._register(page)
            timed_out = False
            try:
                # The DOM, then the text settling (below), rather than "load", which waits for every ad and tracker.
                page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
            except Exception as exc:  # noqa: BLE001
                if "timeout" not in str(exc).lower():
                    raise BrowserError(f"Could not open {url}: {str(exc).splitlines()[0]}", "navigation_failed") from exc
                timed_out = True
            waited = self._wait(page, selector, timeout, settle, deadline)
            return {"tab": key, "url": page.url, "title": page.title(), **waited,
                    **({"timed_out": True} if timed_out else {})}
        return self._call(run, timeout)

    def wait(self, tab: Any, *, selector: str | None = None, timeout: float = 30, settle: float = 2) -> dict[str, Any]:
        def run():
            self._ensure()
            page = self._page(tab)
            try:
                page.wait_for_load_state("load", timeout=timeout * 1000)
            except Exception:  # noqa: BLE001
                pass
            waited = self._wait(page, selector, timeout, settle, time.monotonic() + timeout)
            return {**waited, "url": page.url, "title": page.title()}
        return self._call(run, timeout)

    def evaluate(self, tab: Any, body: str, *, timeout: float = 30) -> dict[str, Any]:
        source = ("async () => await Promise.race([(async () => {\n" + body + "\n})(), new Promise((_, reject) => "
                  f"setTimeout(() => reject(new Error({json.dumps(_TIMEOUT_MARK)})), {int(timeout * 1000)}))])")

        def run():
            self._ensure()
            page = self._page(tab)
            try:
                value = page.evaluate(source)
            except Exception as exc:  # noqa: BLE001
                message = str(exc)
                if _TIMEOUT_MARK in message:
                    raise BrowserError(f"The script did not finish within {timeout:g} seconds.", "timeout") from exc
                if "navigation" in message.lower() or "context was destroyed" in message.lower():
                    raise BrowserError("The page navigated away before the script finished.", "navigated") from exc
                raise BrowserError(f"The script failed in the page: {message[:2000]}", "script_error") from exc
            return {"value": value, "url": page.url, "title": page.title()}
        return self._call(run, timeout)

    def info(self, tab: Any) -> dict[str, Any]:
        def run():
            self._ensure()
            page = self._page(tab)
            return {"url": page.url, "title": page.title()}
        return self._call(run, 10)

    def list_tabs(self) -> list[dict[str, Any]]:
        def run():
            if self._context is None:
                return []
            return [{"tab": key, "url": page.url, "title": page.title()}
                    for key, page in list(self._pages.items()) if not page.is_closed()]
        return self._call(run, 10)

    def focus(self, tab: Any) -> None:
        self._call(lambda: (self._ensure(), self._page(tab).bring_to_front()), 10)

    def close(self, tab: Any) -> None:
        self._call(lambda: self._page(tab).close(), 10)

    def shutdown(self) -> None:
        try:
            self._call(self._reset, 10)
        finally:
            self._executor.shutdown(wait=False)
