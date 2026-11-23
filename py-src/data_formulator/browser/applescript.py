# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Drive the user's own browser on macOS through Apple Events (JavaScript for Automation).

Works with Microsoft Edge, Google Chrome and Safari, signed in as the user. Pages open in a
window of their own so the agent never acts in a tab the user is working in. Each operation is
one ``osascript`` run that also waits for the page, so a call needs no polling from Python.

Apple Events cannot be sent from inside the terminal's sandbox, so these run in the server.
"""

from __future__ import annotations

import json
import plistlib
import secrets
import subprocess
from pathlib import Path
from typing import Any

from data_formulator.browser.base import BrowserError, BrowserDriver, step

APPS = {
    "edge": ("Microsoft Edge", "chromium", "com.microsoft.edgemac"),
    "chrome": ("Google Chrome", "chromium", "com.google.chrome"),
    "safari": ("Safari", "safari", "com.apple.safari"),
}

# Runs one command (argv[0], JSON) against one browser and returns JSON. Tabs are addressed by
# id in Chromium browsers and by position in Safari (whose tabs have no id).
_JXA = r"""
function run(argv) {
  const cmd = JSON.parse(argv[0]);
  let app;
  try { app = Application(cmd.app); app.includeStandardAdditions = false; }
  catch (e) { return JSON.stringify({error: String(e), code: 'not_installed'}); }
  try { return JSON.stringify(dispatch(app, cmd)); }
  catch (e) { return JSON.stringify({error: String(e && e.message || e), number: e && e.errorNumber}); }
}
const now = () => Date.now();
const same = (a, b) => String(a) === String(b);

function chromium(app) { return {
  window: wid => { const w = app.windows.byId(wid); w.id(); return w; },
  ref: (w, tab) => w.tabs.byId(tab),
  open: (w, url) => {
    if (!w) { w = app.Window().make(); w.tabs[0].url = url; return {w, tab: String(w.tabs[0].id())}; }
    w.tabs.push(app.Tab({url})); return {w, tab: String(w.tabs[w.tabs.length - 1].id())};
  },
  navigate: (ref, url) => { ref.url = url; },
  loading: ref => ref.loading(),
  exec: (ref, code) => ref.execute({javascript: code}),
  info: ref => ({url: ref.url(), title: ref.title()}),
  list: w => w.tabs().map(t => ({tab: String(t.id()), url: t.url(), title: t.title()})),
  focus: (w, tab) => { const ids = w.tabs.id().map(String); w.activeTabIndex = ids.indexOf(String(tab)) + 1; w.index = 1; app.activate(); },
  close: (w, tab) => w.tabs.byId(tab).close(),
}; }

function safari(app) { return {
  window: wid => { const w = app.windows.byId(wid); w.id(); return w; },
  ref: (w, tab) => w.tabs[Number(tab) - 1],
  open: (w, url) => {
    if (!w) { app.Document({url}).make(); w = app.windows[0]; return {w, tab: 1}; }
    w.tabs.push(app.Tab({url})); return {w, tab: w.tabs.length};
  },
  navigate: (ref, url) => { ref.url = url; },
  loading: ref => { try { return app.doJavaScript('document.readyState', {in: ref}) !== 'complete'; } catch (e) { return true; } },
  exec: (ref, code) => app.doJavaScript(code, {in: ref}),
  info: ref => ({url: ref.url(), title: ref.name()}),
  list: w => w.tabs().map((t, i) => ({tab: i + 1, url: t.url(), title: t.name()})),
  focus: (w, tab) => { w.currentTab = w.tabs[Number(tab) - 1]; w.index = 1; app.activate(); },
  close: (w, tab) => w.tabs[Number(tab) - 1].close(),
}; }

function textLength(b, ref) {
  try { return b.exec(ref, 'document.body ? document.body.innerText.length : 0'); } catch (e) { return -1; }
}

function waitReady(b, ref, cmd) {
  const deadline = now() + (cmd.timeout || 30) * 1000;
  if (cmd.kind === 'safari') delay(0.6);
  else delay(0.15);
  while (now() < deadline) { let busy = true; try { busy = b.loading(ref); } catch (e) {} if (!busy) break; delay(0.2); }
  if (cmd.selector) {
    const probe = '!!document.querySelector(' + JSON.stringify(cmd.selector) + ')';
    let found = false;
    while (now() < deadline) { try { found = b.exec(ref, probe) === true; } catch (e) {} if (found) break; delay(0.25); }
    if (!found) return {timed_out: true, waited_for: cmd.selector};
  }
  // Pages that draw themselves with JavaScript keep changing after "load": wait until the text settles.
  const settle = Math.min(deadline, now() + (cmd.settle == null ? 2 : cmd.settle) * 1000);
  let last = textLength(b, ref), stable = 0;
  while (now() < settle && stable < 2) { delay(0.4); const len = textLength(b, ref); stable = len === last && len > 0 ? stable + 1 : 0; last = len; }
  return {timed_out: now() >= deadline};
}

function evaluate(b, ref, cmd) {
  const started = b.exec(ref, cmd.start);
  if (started !== 'started') return {error: 'The script did not start; check it for syntax errors.', code: 'not_started'};
  const deadline = now() + (cmd.timeout || 30) * 1000;
  let pause = 0.05;
  while (now() < deadline) {
    let result = '';
    try { result = b.exec(ref, cmd.poll); } catch (e) { result = ''; }
    if (result === '__gone__') return {navigated: true};
    if (result) return {result};
    delay(pause); pause = Math.min(pause * 1.5, 0.3);
  }
  return {timed_out: true};
}

function dispatch(app, cmd) {
  const b = cmd.kind === 'safari' ? safari(app) : chromium(app);
  if (cmd.op === 'probe') {
    const out = {running: app.running()};
    if (!out.running) { app.launch(); delay(1.5); }
    out.windows = app.windows.length;  // fails with -1743 when Automation is not allowed
    const opened = b.open(null, 'about:blank');
    delay(0.4);
    try { out.js = b.exec(b.ref(opened.w, opened.tab), '6 * 7'); } catch (e) { out.js_error = String(e && e.message || e); }
    try { opened.w.close(); } catch (e) {}
    return out;
  }
  let w = null;
  if (cmd.window) { try { w = b.window(cmd.window); } catch (e) { w = null; } }
  if (cmd.op === 'open') {
    let tab = null;
    if (w && cmd.tab != null) { try { b.navigate(b.ref(w, cmd.tab), cmd.url); tab = cmd.tab; } catch (e) { tab = null; } }
    if (tab == null) { const opened = b.open(w, cmd.url); w = opened.w; tab = opened.tab; }
    const ref = b.ref(w, tab);
    const waited = waitReady(b, ref, cmd);
    return Object.assign({window: String(w.id()), tab}, b.info(ref), waited);
  }
  if (!w) return {error: 'The Data Formulator browser window was closed.', code: 'gone'};
  if (cmd.op === 'list') return {tabs: b.list(w)};
  let ref;
  try { ref = b.ref(w, cmd.tab); ref.url(); } catch (e) { return {error: 'That tab was closed.', code: 'gone'}; }
  if (cmd.op === 'wait') return Object.assign(waitReady(b, ref, cmd), b.info(ref));
  if (cmd.op === 'eval') return Object.assign(evaluate(b, ref, cmd), b.info(ref));
  if (cmd.op === 'info') return b.info(ref);
  if (cmd.op === 'focus') { b.focus(w, cmd.tab); return {}; }
  if (cmd.op === 'close') { b.close(w, cmd.tab); return {}; }
  return {error: 'Unknown operation ' + cmd.op};
}
"""

_START = r"""(function(){
  var K = __KEY__; window.__df = window.__df || {}; window.__df[K] = '';
  (async () => {
__BODY__
  })().then(function (v) {
    try { window.__df[K] = JSON.stringify({ok: true, value: v === undefined ? null : v}); }
    catch (e) { window.__df[K] = JSON.stringify({ok: false, error: 'The result is not JSON-serializable: ' + e}); }
  }, function (e) { window.__df[K] = JSON.stringify({ok: false, error: String(e && e.stack || e)}); });
  return 'started';
})()"""

_POLL = "(function(){var d=window.__df; if(!d||!(__KEY__ in d)) return '__gone__'; var r=d[__KEY__]; if(r){delete d[__KEY__];} return r;})()"

JS_DISABLED_HINTS = ("allow javascript from apple events", "javascript through applescript is turned off")


def default_browser_bundle() -> str | None:
    """The bundle id of the user's default web browser, from Launch Services."""
    path = Path.home() / "Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist"
    try:
        handlers = plistlib.loads(path.read_bytes()).get("LSHandlers", [])
    except (OSError, plistlib.InvalidFileException, ValueError):
        return None
    for handler in handlers:
        if handler.get("LSHandlerURLScheme") in ("https", "http"):
            bundle = handler.get("LSHandlerRoleAll")
            if bundle:
                return str(bundle).lower()
    return None


def installed(app_name: str) -> bool:
    return any(Path(root, f"{app_name}.app").exists() for root in ("/Applications", Path.home() / "Applications"))


def app_version(app_name: str) -> str | None:
    """The app's version (``CFBundleShortVersionString``), e.g. ``18.1``; the bundle's Info.plist needs no permission to read."""
    for root in ("/Applications", Path.home() / "Applications"):
        try:
            version = plistlib.loads(Path(root, f"{app_name}.app", "Contents", "Info.plist").read_bytes()).get("CFBundleShortVersionString")
        except (OSError, plistlib.InvalidFileException, ValueError):
            continue
        if version:
            return str(version)
    return None


def pick_browser(choice: str) -> str | None:
    """``edge``, ``chrome`` or ``safari`` for a setting of auto or a specific browser, or None."""
    if choice in APPS:
        return choice if installed(APPS[choice][0]) else None
    default = default_browser_bundle()
    for key, (name, _, bundle) in APPS.items():
        if bundle == default and installed(name):
            return key
    return next((key for key in ("edge", "chrome", "safari") if installed(APPS[key][0])), None)


class AppleScriptDriver(BrowserDriver):
    uses_user_profile = True

    def __init__(self, key: str) -> None:
        self.key = key
        self.app, self.kind, _ = APPS[key]
        self.label = self.app
        self.version = app_version(self.app)
        self.positional_tabs = self.kind == "safari"
        self.window: str | None = None

    def _run(self, op: str, timeout: float = 30, **fields: Any) -> dict[str, Any]:
        command = {"op": op, "app": self.app, "kind": self.kind, "window": self.window, "timeout": timeout, **fields}
        try:
            completed = subprocess.run(["osascript", "-l", "JavaScript", "-e", _JXA, json.dumps(command)],
                                       capture_output=True, text=True, timeout=timeout + 20)
        except subprocess.TimeoutExpired as exc:
            raise BrowserError(f"{self.app} did not respond in time.", "timeout") from exc
        except OSError as exc:
            raise BrowserError(f"Could not run osascript: {exc}", "unavailable") from exc
        text = (completed.stdout or "").strip()
        try:
            result = json.loads(text) if text else {}
        except ValueError:
            result = {}
        if completed.returncode != 0 and not result:
            result = {"error": (completed.stderr or "osascript failed").strip()}
        if "error" in result:
            raise self._error(result)
        return result

    def _error(self, result: dict[str, Any]) -> BrowserError:
        message, number = str(result.get("error", "")), result.get("number")
        if number == -1743 or "not authorized to send apple events" in message.lower():
            return BrowserError(f"macOS has not allowed Data Formulator to control {self.app}.", "automation_denied")
        if any(hint in message.lower() for hint in JS_DISABLED_HINTS):
            return BrowserError(f"{self.app} does not allow JavaScript from Apple Events.", "javascript_disabled")
        if number == -600:
            return BrowserError(f"{self.app} is not running.", "not_running")
        return BrowserError(message or f"{self.app} reported an error.", result.get("code") or "error")

    def probe(self) -> list[dict[str, Any]]:
        steps = [step("installed", True)]
        try:
            result = self._run("probe", timeout=20)
        except BrowserError as exc:
            if exc.code == "javascript_disabled":
                return steps + [step("automation", True), step("javascript", False, str(exc))]
            return steps + [step("automation", False, str(exc)), step("javascript", None)]
        steps.append(step("automation", True))
        if result.get("js") == 42:
            steps.append(step("javascript", True))
        else:
            error = result.get("js_error", "")
            disabled = any(hint in error.lower() for hint in JS_DISABLED_HINTS)
            steps.append(step("javascript", False, f"{self.app} does not allow JavaScript from Apple Events." if disabled
                              else error or "JavaScript did not run."))
        return steps

    def open(self, url: str, tab: Any = None, *, selector: str | None = None, timeout: float = 30, settle: float = 2) -> dict[str, Any]:
        result = self._run("open", timeout=timeout, url=url, tab=tab, selector=selector, settle=settle)
        self.window = result.pop("window")
        return result

    def wait(self, tab: Any, *, selector: str | None = None, timeout: float = 30, settle: float = 2) -> dict[str, Any]:
        return self._run("wait", timeout=timeout, tab=tab, selector=selector, settle=settle)

    def evaluate(self, tab: Any, body: str, *, timeout: float = 30) -> dict[str, Any]:
        key = json.dumps(secrets.token_hex(6))
        result = self._run("eval", timeout=timeout, tab=tab,
                           start=_START.replace("__KEY__", key).replace("__BODY__", body),
                           poll=_POLL.replace("__KEY__", key))
        if result.get("timed_out"):
            raise BrowserError(f"The script did not finish within {timeout:g} seconds.", "timeout")
        if result.get("navigated"):
            raise BrowserError("The page navigated away before the script finished.", "navigated")
        payload = json.loads(result["result"])
        if not payload.get("ok"):
            raise BrowserError(f"The script failed in the page: {payload.get('error', '')[:2000]}", "script_error")
        return {"value": payload.get("value"), "url": result.get("url"), "title": result.get("title")}

    def info(self, tab: Any) -> dict[str, Any]:
        return self._run("info", tab=tab)

    def list_tabs(self) -> list[dict[str, Any]]:
        if not self.window:
            return []
        try:
            return self._run("list")["tabs"]
        except BrowserError as exc:
            if exc.code == "gone":
                self.window = None
                return []
            raise

    def focus(self, tab: Any) -> None:
        self._run("focus", tab=tab)

    def close(self, tab: Any) -> None:
        self._run("close", tab=tab)
