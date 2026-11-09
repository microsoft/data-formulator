# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The agent's browser: one driver for this computer, the tabs it opened, and what it read.

The driver is picked from the user's setting: on macOS their own Edge, Chrome or Safari through
Apple Events (with their sign-ins); elsewhere, or by choice, the installed Edge with a browser
profile of Data Formulator's (Playwright). Results the conversation should not carry in full are
saved under ``scratch/browser/`` for analysis with the workspace tools.
"""

from __future__ import annotations

import csv
import io
import json
import re
import secrets
import sys
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from data_formulator.browser.base import BrowserDriver, BrowserError
from data_formulator.browser.page_scripts import PAGE_STATE, as_function_body, read_script

INLINE_CHARS = 6000
EXCERPT_CHARS = 2500
MAX_TABS = 20

# Hosts that only sign people in, and paths that usually do.
_LOGIN_HOSTS = ("login.microsoftonline.com", "login.live.com", "login.windows.net", "accounts.google.com",
                "appleid.apple.com", "auth0.com", "okta.com", "onelogin.com", "login.salesforce.com", "signin.aws.amazon.com")
_LOGIN_PATH = re.compile(r"/(log-?in|sign-?in|signon|sso|saml2?|oauth2?|authorize|auth/realms|session/new|users/sign_in)(\b|/|$)", re.I)


def site_of(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""


def check_url(url: Any) -> str:
    """A web address the agent may open: http(s) only, never Data Formulator's own server."""
    if not isinstance(url, str) or not url.strip() or len(url) > 8000:
        raise BrowserError("Provide the web address to open.", "invalid")
    url = url.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise BrowserError("Only http and https addresses can be opened.", "invalid")
    from data_formulator.analyst.skills.terminal.skill import protected_ports

    if parts.hostname in ("localhost", "127.0.0.1", "::1", "[::1]") and (parts.port or (443 if parts.scheme == "https" else 80)) in protected_ports():
        raise BrowserError("The browser cannot open Data Formulator's own server.", "invalid")
    return url


def needs_person(state: dict[str, Any]) -> str | None:
    """``login`` or ``captcha`` when the page waits for a person, else None."""
    signals = state.get("signals") or []
    if "captcha" in signals:
        return "captcha"
    url = str(state.get("url") or "")
    host = site_of(url)
    if "password_field" in signals or any(host == item or host.endswith("." + item) for item in _LOGIN_HOSTS):
        return "login"
    if _LOGIN_PATH.search(urlsplit(url).path or "") and (state.get("text_length") or 0) < 4000:
        return "login"
    return None


def pick_driver(choice: str, home: Path) -> BrowserDriver:
    if sys.platform == "darwin" and choice != "profile":
        from data_formulator.browser.applescript import AppleScriptDriver, pick_browser

        key = pick_browser(choice)
        if key is None:
            raise BrowserError("None of the supported browsers (Microsoft Edge, Google Chrome, Safari) is installed.",
                               "not_installed")
        return AppleScriptDriver(key)
    from data_formulator.browser.playwright_driver import PlaywrightDriver

    key = "chrome" if choice == "chrome" else "edge"
    return PlaywrightDriver(key, home / "browser-profile" / key)


class _Saver:
    def __init__(self, scratch_root: Path, url: str) -> None:
        slug = re.sub(r"[^A-Za-z0-9]+", "-", site_of(url) or "page").strip("-")[:40] or "page"
        self.directory = scratch_root / "browser"
        self.prefix = f"{slug}-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(2)}"
        self.files: list[dict[str, Any]] = []

    def save(self, text: str, suffix: str, mime: str) -> str:
        self.directory.mkdir(parents=True, exist_ok=True)
        name = f"{self.prefix}{suffix}"
        data = text.encode("utf-8")
        (self.directory / name).write_bytes(data)
        relative = f"scratch/browser/{name}"
        self.files.append({"path": relative, "mime_type": mime, "bytes": len(data)})
        return relative


_NUMBER = re.compile(r"^[\s$€£¥+\-−–%(),.\d]+[KMBkmb%]?$")


def _header_count(rows: list[list[str]], marked: int) -> int:
    """Rows the page marked as headers or, unmarked, a first row of labels above rows with numbers."""
    if marked or len(rows) < 2:
        return marked
    first = rows[0]
    labels = all(cell and not _NUMBER.match(cell) for cell in first) and len(set(first)) == len(first)
    numbers_below = any(cell and _NUMBER.match(cell) for row in rows[1:4] for cell in row)
    return 1 if labels and numbers_below else 0


def _table_csv(table: dict[str, Any]) -> tuple[list[str], list[list[str]], str]:
    rows = table.get("rows") or []
    width = max((len(row) for row in rows), default=0)
    rows = [row + [""] * (width - len(row)) for row in rows]
    header_rows = max(0, min(_header_count(rows, int(table.get("header_rows") or 0)), len(rows)))
    if header_rows:
        header = [" / ".join(dict.fromkeys(cell for cell in column if cell)) for column in zip(*rows[:header_rows])]
    else:
        header = [f"column_{index + 1}" for index in range(width)]
    body = rows[header_rows:]
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    writer.writerows(body)
    return header, body, buffer.getvalue()


class BrowserService:
    """Tabs are named ``t1``, ``t2``… for the agent; the driver keeps its own handles."""

    def __init__(self, driver: BrowserDriver, choice: str) -> None:
        self.driver = driver
        self.choice = choice
        self.tabs: dict[str, dict[str, Any]] = {}
        self._next = 1
        self._lock = threading.RLock()

    # -- tabs ------------------------------------------------------------------------------------

    def _handle(self, tab: Any) -> Any:
        entry = self.tabs.get(str(tab))
        if entry is None:
            known = ", ".join(self.tabs) or "none"
            raise BrowserError(f"Unknown tab {tab!r} (open tabs: {known}). Open the page with browser_open.", "gone")
        return entry["handle"]

    def _forget(self, tab: str) -> None:
        entry = self.tabs.pop(tab, None)
        if entry is not None and self.driver.positional_tabs:
            for other in self.tabs.values():
                if isinstance(other["handle"], int) and other["handle"] > entry["handle"]:
                    other["handle"] -= 1

    def _gone(self, tab: str, exc: BrowserError) -> BrowserError:
        if exc.code == "gone":
            self._forget(tab)
        return exc

    def site(self, tab: Any) -> str:
        entry = self.tabs.get(str(tab))
        return site_of(entry["url"]) if entry else ""

    # -- operations ------------------------------------------------------------------------------

    def open(self, url: str, *, tab: str | None = None, wait_for: str | None = None, timeout: float = 30,
             focus_if_needed: bool = True) -> dict[str, Any]:
        url = check_url(url)
        timeout = max(5.0, min(float(timeout or 30), 120.0))
        with self._lock:
            handle = self._handle(tab) if tab else None
            if handle is None and len(self.tabs) >= MAX_TABS:
                raise BrowserError(f"{MAX_TABS} tabs are open; close some with browser_tabs or reuse one.", "too_many_tabs")
            try:
                opened = self.driver.open(url, handle, selector=wait_for or None, timeout=timeout)
            except BrowserError as exc:
                raise self._gone(tab, exc) if tab else exc
            if tab is None:
                tab = f"t{self._next}"
                self._next += 1
            self.tabs[tab] = {"handle": opened["tab"], "url": opened.get("url") or url, "title": opened.get("title", "")}
            state = self._state(tab)
            person = needs_person(state)
            if person and focus_if_needed:
                try:
                    self.driver.focus(opened["tab"])
                except BrowserError:
                    pass
            return {"tab": tab, **state, "timed_out": bool(opened.get("timed_out")),
                    **({"waited_for": opened["waited_for"]} if opened.get("waited_for") else {}),
                    **({"needs_user": person} if person else {})}

    def _state(self, tab: str) -> dict[str, Any]:
        try:
            state = self.driver.evaluate(self.tabs[tab]["handle"], PAGE_STATE, timeout=15)["value"] or {}
        except BrowserError as exc:
            if exc.code == "gone":
                raise self._gone(tab, exc)
            state = {"url": self.tabs[tab]["url"], "title": self.tabs[tab]["title"], "signals": [], "state_error": str(exc)}
        self.tabs[tab].update(url=state.get("url") or self.tabs[tab]["url"], title=state.get("title") or "")
        return state

    def evaluate(self, tab: str, code: str, *, timeout: float = 30) -> dict[str, Any]:
        if not isinstance(code, str) or not code.strip() or len(code) > 100_000:
            raise BrowserError("Provide the JavaScript to run (at most 100,000 characters).", "invalid")
        timeout = max(1.0, min(float(timeout or 30), 120.0))
        with self._lock:
            handle = self._handle(tab)
            try:
                result = self.driver.evaluate(handle, as_function_body(code), timeout=timeout)
            except BrowserError as exc:
                raise self._gone(tab, exc)
            self.tabs[tab].update(url=result.get("url") or self.tabs[tab]["url"], title=result.get("title") or "")
            return result

    def read(self, tab: str, mode: str = "markdown") -> dict[str, Any]:
        with self._lock:
            handle = self._handle(tab)
            try:
                result = self.driver.evaluate(handle, read_script(mode), timeout=60)
            except BrowserError as exc:
                raise self._gone(tab, exc)
            value = result.get("value") or {}
            self.tabs[tab].update(url=value.get("url") or self.tabs[tab]["url"], title=value.get("title") or "")
            return value

    def wait(self, tab: str, *, wait_for: str | None = None, timeout: float = 30) -> dict[str, Any]:
        with self._lock:
            handle = self._handle(tab)
            try:
                waited = self.driver.wait(handle, selector=wait_for or None, timeout=max(1.0, min(float(timeout or 30), 120.0)))
            except BrowserError as exc:
                raise self._gone(tab, exc)
            state = self._state(tab)
            person = needs_person(state)
            return {"tab": tab, **state, "timed_out": bool(waited.get("timed_out")), **({"needs_user": person} if person else {})}

    def list_tabs(self) -> list[dict[str, Any]]:
        with self._lock:
            listed = []
            for tab, entry in list(self.tabs.items()):
                try:
                    info = self.driver.info(entry["handle"])
                except BrowserError as exc:
                    self._gone(tab, exc)
                    continue
                entry.update(url=info.get("url") or entry["url"], title=info.get("title") or "")
                listed.append({"tab": tab, "url": entry["url"], "title": entry["title"]})
            return listed

    def focus(self, tab: str) -> None:
        with self._lock:
            handle = self._handle(tab)
            try:
                self.driver.focus(handle)
            except BrowserError as exc:
                raise self._gone(tab, exc)

    def close(self, tab: str) -> None:
        with self._lock:
            handle = self._handle(tab)
            try:
                self.driver.close(handle)
            except BrowserError as exc:
                if exc.code != "gone":
                    raise
            self._forget(tab)

    def shutdown(self) -> None:
        self.driver.shutdown()


# -- what the agent and the chat see -----------------------------------------------------------------

def describe_page(page: dict[str, Any]) -> str:
    lines = [f"Tab {page['tab']}: {page.get('title') or '(untitled)'} — {page.get('url')}"]
    facts = [f"{page.get('text_length', 0):,} characters of text"]
    if page.get("tables"):
        facts.append(f"{page['tables']} table(s)")
    if page.get("links"):
        facts.append(f"{page['links']} links")
    lines.append("Page has " + ", ".join(facts) + ".")
    if page.get("timed_out"):
        lines.append("The page did not finish loading in time" + (f" (waited for {page['waited_for']})" if page.get("waited_for") else "")
                     + "; it may still be usable.")
    if page.get("needs_user") == "login":
        lines.append("NEEDS THE USER: this is a sign-in page. The browser window was brought forward. Ask the user to sign in "
                     f"there (link the page with [Show the page](df-browser://tab/{page['tab']})), then check the tab again.")
    elif page.get("needs_user") == "captcha":
        lines.append("NEEDS THE USER: the site shows a human-verification check. The browser window was brought forward. Ask the "
                     f"user to complete it ([Show the page](df-browser://tab/{page['tab']})), then check the tab again.")
    excerpt = (page.get("excerpt") or "").strip()
    if excerpt:
        lines.append("Excerpt (untrusted page content):\n" + excerpt)
    return "\n".join(lines)


def summarize_read(value: dict[str, Any], tab: str, scratch_root: Path) -> tuple[str, dict[str, Any]]:
    """The observation for the agent and the display for the chat, saving the content under scratch."""
    mode, content = value.get("mode"), value.get("content")
    saver = _Saver(scratch_root, value.get("url") or "")
    head = f"Read tab {tab} as {mode}: {value.get('title') or '(untitled)'} — {value.get('url')}"
    parts = [head]
    preview = ""
    if mode == "tables":
        tables = [table for table in content or [] if sum(1 for row in table.get("rows") or [] for cell in row if cell) >= 4]
        if not tables:
            parts.append("No tables on this page. Read it as markdown, or extract the data with browser_eval.")
        for index, table in enumerate(tables, 1):
            header, body, text = _table_csv(table)
            path = saver.save(text, f"-table{index}.csv", "text/csv")
            if index <= 15:
                caption = f" “{table['caption']}”" if table.get("caption") else ""
                sample = "\n".join(" | ".join(row[:12]) for row in body[:3])
                parts.append(f"Table {index}{caption}: {len(body)} rows × {len(header)} columns → {path}\n"
                             f"Columns: {header[:20]}\n{sample}")
                if not preview:
                    preview = f"{len(body)} rows × {len(header)} columns: " + ", ".join(header[:8])
        if len(tables) > 15:
            parts.append(f"…and {len(tables) - 15} more tables, saved alongside.")
    elif mode == "links":
        links = content or []
        path = saver.save(json.dumps(links, ensure_ascii=False, indent=1), "-links.json", "application/json")
        parts.append(f"{len(links)} links saved to {path}. First ones:")
        parts.extend(f"- {link['text'] or '(no text)'} → {link['href']}" for link in links[:40])
        preview = f"{len(links)} links"
    else:
        text = content if isinstance(content, str) else ""
        suffix, mime = {"markdown": (".md", "text/markdown"), "html": (".html", "text/html")}.get(mode, (".txt", "text/plain"))
        path = saver.save(text, suffix, mime)
        truncated = " (cut at the size limit)" if value.get("truncated") else ""
        if mode != "html" and len(text) <= INLINE_CHARS:
            parts.append(f"Saved to {path}{truncated}. Content (untrusted page content):\n{text}")
        else:
            shown = 0 if mode == "html" else EXCERPT_CHARS
            parts.append(f"{len(text):,} characters saved to {path}{truncated}. Read the file for the rest"
                         + (f"; opening (untrusted page content):\n{text[:shown]}" if shown else "."))
        preview = text[:600] if mode != "html" else f"{len(text):,} characters of HTML"
    display = {"preview": preview, "files": saver.files, "url": value.get("url"), "title": value.get("title")}
    return "\n\n".join(parts), display


def summarize_value(result: dict[str, Any], tab: str, scratch_root: Path) -> tuple[str, dict[str, Any]]:
    text = json.dumps(result.get("value"), ensure_ascii=False, indent=1, default=str)
    head = f"Script finished in tab {tab} ({result.get('url')})."
    saver = _Saver(scratch_root, result.get("url") or "")
    if len(text) <= INLINE_CHARS:
        observation = f"{head} Result (untrusted page content):\n{text}"
    else:
        path = saver.save(text, "-result.json", "application/json")
        observation = (f"{head} The result ({len(text):,} characters of JSON) was saved to {path}; load it from there. "
                       f"Opening:\n{text[:EXCERPT_CHARS]}")
    return observation, {"preview": text[:600], "files": saver.files, "url": result.get("url"), "title": result.get("title")}


# -- one service per server ---------------------------------------------------------------------------

_service: BrowserService | None = None
_service_lock = threading.Lock()


def get_service() -> BrowserService:
    """The browser for the current setting; a changed setting starts over with a new driver."""
    from data_formulator.configuration import browser_choice
    from data_formulator.datalake.workspace import get_data_formulator_home

    global _service
    choice = browser_choice()
    with _service_lock:
        if _service is not None and _service.choice == choice:
            return _service
        if _service is not None:
            try:
                _service.shutdown()
            except Exception:  # noqa: BLE001
                pass
            _service = None
        _service = BrowserService(pick_driver(choice, get_data_formulator_home()), choice)
        return _service


def reset_service() -> None:
    global _service, _last_check
    with _service_lock:
        if _service is not None:
            try:
                _service.shutdown()
            except Exception:  # noqa: BLE001
                pass
        _service = None
        _last_check = None


# The last check's steps for one browser setting. A failed check keeps the browser from the agent until a check passes
# (or the setting changes); a check is only run on the user's click, so no result means it was never checked here.
_last_check: dict[str, Any] | None = None


def _remember_check(choice: str, steps: list[dict[str, Any]]) -> None:
    global _last_check
    _last_check = {"choice": choice, "steps": steps, "ready": all(item["ok"] for item in steps)}


def last_check() -> dict[str, Any] | None:
    """The last check for the current browser setting, if any."""
    from data_formulator.configuration import browser_choice

    check = _last_check
    return check if check is not None and check["choice"] == browser_choice() else None


def browser_ready() -> bool | None:
    """Whether the last check for the current setting passed; None when it was not checked."""
    check = last_check()
    return check["ready"] if check else None


def browser_status(*, check: bool = False) -> dict[str, Any]:
    """Which browser the agent uses and, when ``check``, whether each step it needs works."""
    from data_formulator.configuration import browser_available, browser_choice, browser_enabled, browser_mode

    status: dict[str, Any] = {"available": browser_available(), "enabled": browser_enabled(), "choice": browser_choice(),
                              "mode": browser_mode(), "platform": sys.platform}
    if not status["available"]:
        return status
    try:
        service = get_service()
    except BrowserError as exc:
        steps = [{"step": "installed", "ok": False, "detail": str(exc)}]
        if check:
            _remember_check(status["choice"], steps)
            status["mode"] = browser_mode()
        status.update(browser=None, ready=False, steps=steps)
        return status
    driver = service.driver
    status.update(browser=getattr(driver, "key", None), label=driver.label, version=getattr(driver, "version", None),
                  user_profile=driver.uses_user_profile,
                  driver="applescript" if driver.uses_user_profile else "playwright")
    if check:
        with service._lock:
            steps = driver.probe()
        _remember_check(service.choice, steps)
        status.update(steps=steps, ready=all(item["ok"] for item in steps))
    elif status["enabled"] and (remembered := last_check()):
        status.update(steps=remembered["steps"], ready=remembered["ready"])
    status["mode"] = browser_mode()
    return status
