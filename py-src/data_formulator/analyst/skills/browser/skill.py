# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""The browser skill: open, read and script web pages in the user's browser (see ``data_formulator.browser``).

Opening, reading and scripting a page are actions: in Ask mode the first call on a site pauses for
the user's approval (for this chat, or always), through the same approval channel MCP tools use;
in Auto they run at once. Tab housekeeping (``browser_tabs``) is an inspection tool.
"""

from __future__ import annotations

import json
import secrets
import threading
from typing import Any, Generator

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult
from data_formulator.browser.base import BrowserError

ACTIONS = ("browser_open", "browser_read", "browser_eval")
SETUP_CODES = {"automation_denied", "javascript_disabled", "not_installed", "launch_failed", "unavailable"}

_allowances: dict[tuple[str, str], set[str]] = {}
_allowances_lock = threading.Lock()


def require_local_browser_request() -> None:
    from data_formulator.analyst.skills.terminal.skill import require_local_terminal_request
    from data_formulator.configuration import browser_mode

    try:
        require_local_terminal_request(check_policy=False)
    except ValueError as exc:
        raise ValueError(str(exc).replace("Terminal", "The browser")) from exc
    if browser_mode() == "off":
        raise ValueError("The browser is turned off. The user can turn it on in Tools → Browser.")


def _matches(site: str, allowed: str) -> bool:
    return site == allowed or site.endswith("." + allowed)


def site_allowed(owner: str, conversation: str, site: str) -> bool:
    from data_formulator.configuration import browser_allowed_sites

    if not site:
        return True
    with _allowances_lock:
        if any(_matches(site, item) for item in _allowances.get((owner, conversation), ())):
            return True
    return any(_matches(site, item) for item in browser_allowed_sites())


def allow_site(owner: str, conversation: str, site: str, *, always: bool) -> None:
    if not site:
        return
    with _allowances_lock:
        _allowances.setdefault((owner, conversation), set()).add(site)
    if always:
        from data_formulator.configuration import read_configuration, save_configuration

        document = read_configuration()
        sites = list(document["overrides"].get("browser_allowed_sites", []))
        if site not in sites:
            save_configuration({**document["overrides"], "browser_allowed_sites": sites + [site]}, document["revision"])


def _setup_hint(exc: BrowserError) -> str:
    if exc.code in SETUP_CODES:
        return (" The browser is not set up on this computer; tell the user to open Tools → Browser and run the check, "
                "which shows how to fix it. Do not retry until they say it is fixed.")
    if exc.code == "gone":
        return " Open the page again with browser_open."
    return ""


def _target(service, action: str, spec: dict[str, Any]) -> str:
    from data_formulator.browser.service import check_url, site_of

    if action == "browser_open":
        return site_of(check_url(spec.get("url")))
    tab = str(spec.get("tab") or "")
    if tab not in service.tabs:
        raise BrowserError(f"Unknown tab {tab!r}. Open the page with browser_open first.", "gone")
    return service.site(tab)


def _title(action: str, spec: dict[str, Any], site: str) -> str:
    if action == "browser_open":
        return f"Open {site}"
    if action == "browser_read":
        return f"Read {spec.get('as') or 'markdown'} from {site}"
    return f"Run a script on {site}"


def run_browser_call(proposal: dict[str, Any], scratch_root) -> tuple[dict[str, Any], str]:
    """Do the call; returns ``(display for the chat, observation for the agent)``."""
    from data_formulator.browser.service import describe_page, get_service, summarize_read, summarize_value

    action, spec = proposal["tool"], proposal["arguments"]
    try:
        service = get_service()
        if action == "browser_open":
            page = service.open(spec.get("url"), tab=spec.get("tab") or None, wait_for=spec.get("wait_for") or None,
                                timeout=spec.get("timeout_seconds") or 30)
            display = {"preview": f"{page.get('title') or page.get('url')}"
                       + (" · waiting for you to sign in" if page.get("needs_user") == "login" else "")
                       + (" · waiting for a verification check" if page.get("needs_user") == "captcha" else ""),
                       "files": [], "url": page.get("url"), "title": page.get("title"), "tab": page["tab"],
                       **({"needs_user": page["needs_user"]} if page.get("needs_user") else {})}
            return display, describe_page(page)
        tab = str(spec.get("tab") or "")
        if action == "browser_read":
            value = service.read(tab, spec.get("as") or "markdown")
            observation, display = summarize_read(value, tab, scratch_root)
            return {**display, "tab": tab}, observation
        if action == "browser_eval":
            result = service.evaluate(tab, spec.get("script"), timeout=spec.get("timeout_seconds") or 30)
            observation, display = summarize_value(result, tab, scratch_root)
            return {**display, "tab": tab}, observation
    except BrowserError as exc:
        return {"error": str(exc), "files": [], "code": exc.code}, f"[ERROR] {exc}{_setup_hint(exc)}"
    except (OSError, ValueError) as exc:
        return {"error": str(exc), "files": []}, f"[ERROR] {exc}"
    return {"error": "Unknown browser action.", "files": []}, "[ERROR] Unknown browser action."


def resume_browser_call(proposal: dict[str, Any], decision: str, *, owner: str, conversation: str,
                        scratch_root) -> tuple[dict[str, Any], str]:
    """Finish a call that waited for the user's approval."""
    if decision == "reject":
        return ({"rejected": True, "files": []},
                f"The user did not allow the browser on {proposal.get('site')}. Do not retry it; continue without that site "
                "or ask the user how to proceed.")
    try:
        allow_site(owner, conversation, proposal.get("site", ""), always=decision == "always")
    except (OSError, ValueError):
        pass
    return run_browser_call(proposal, scratch_root)


class BrowserSkill:
    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        from data_formulator.browser.service import get_service

        if name != "browser_tabs":
            return ToolResult(text="Opening, reading and scripting pages are actions, not inspection tools.")
        try:
            require_local_browser_request()
            service = get_service()
            action, tab = args.get("action"), str(args.get("tab") or "")
            if action == "list":
                tabs = service.list_tabs()
                return ToolResult(text=json.dumps({"tabs": tabs}, ensure_ascii=False) if tabs else "No tabs are open.")
            if not tab:
                return ToolResult(text="Give the tab id.")
            if action == "check":
                page = service.wait(tab, timeout=10)
                fields = {key: page.get(key) for key in ("tab", "url", "title", "text_length", "tables", "needs_user")}
                hint = ("Still waiting for the user." if page.get("needs_user")
                        else "The page no longer waits for the user; continue with browser_read or browser_eval.")
                return ToolResult(text=json.dumps(fields, ensure_ascii=False) + "\n" + hint)
            if action == "show":
                service.focus(tab)
                return ToolResult(text=f"Tab {tab} is in front of the user now.")
            if action == "close":
                service.close(tab)
                return ToolResult(text=f"Closed tab {tab}.")
            return ToolResult(text="Use list, check, show or close.")
        except BrowserError as exc:
            return ToolResult(text=f"[ERROR] {exc}{_setup_hint(exc)}")
        except ValueError as exc:
            return ToolResult(text=f"[ERROR] {exc}")

    def handle_action(self, action: str, spec: dict[str, Any], ctx: SkillContext) -> Generator[Event, None, str | None]:
        from data_formulator.auth.identity import get_identity_id
        from data_formulator.browser.service import get_service
        from data_formulator.configuration import browser_mode
        from data_formulator.mcp_servers.skill import get_requests
        from data_formulator.workspace_factory import get_active_workspace_id

        if action not in ACTIONS:
            return "Unknown browser action."
        try:
            require_local_browser_request()
        except ValueError as exc:
            return f"[ERROR] {exc}"
        owner = get_identity_id()
        conversation = ctx.payload.get("conversation_id")
        workspace_id = get_active_workspace_id() or ""
        if not owner or not isinstance(conversation, str) or not conversation:
            return "[ERROR] A local identity and conversation are required for the browser."
        arguments = {key: value for key, value in spec.items() if key in ("url", "tab", "wait_for", "timeout_seconds", "as", "script")}
        try:
            service = get_service()
            site = _target(service, action, arguments)
        except BrowserError as exc:
            return f"[ERROR] {exc}{_setup_hint(exc)}"
        proposal = {
            "kind": "browser", "server_id": "browser", "server_name": service.driver.label, "tool": action,
            "title": _title(action, arguments, site), "site": site,
            "description": ("Uses your own browser, signed in as you." if service.driver.uses_user_profile
                            else "Uses Data Formulator's browser window."),
            "annotations": {"readOnly": action != "browser_eval"}, "arguments": arguments,
            "purpose": (ctx.payload.get("action_narration") or "").strip()[:2000],
        }
        if browser_mode() == "ask" and not site_allowed(owner, conversation, site):
            try:
                proposal = get_requests().propose(owner, conversation, workspace_id, proposal)
            except ValueError as exc:
                return f"[ERROR] {exc}"
            yield {"type": "interact", "mcp_request": proposal}
            return None
        proposal = {**proposal, "id": secrets.token_urlsafe(24), "decision": "auto"}
        yield {"type": "mcp_started", "request": proposal}
        display, observation = run_browser_call(proposal, ctx.workspace.confined_scratch.root)
        yield {"type": "mcp_result", "request": proposal, "result": display}
        return observation


def get_skill() -> BrowserSkill:
    return BrowserSkill()
