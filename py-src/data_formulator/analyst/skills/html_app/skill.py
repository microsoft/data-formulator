# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""html_app skill — writes an interactive HTML app as a workspace file.

``write_html_app`` is a committing action. The handler validates the request,
stamps a ``df-app-manifest`` declaring which workspace tables the app may read,
and saves the document as an agent-managed ``text/html`` workspace file so later
revisions go through the workspace skill's hash-checked ``edit_file``.

The frontend renders the file in an opaque-origin sandboxed iframe with a
restrictive CSP and injects the DF runtime; the app reads declared tables through
a host bridge. Nothing here is a security boundary — the sandbox is. The lint
warnings returned to the model only steer it away from code that cannot work in
the sandbox (network calls, external assets, browser storage).

  - ``{"type": "action", "action": "write_html_app", "file": {...}}``
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Generator
from urllib.parse import quote

from data_formulator.analyst.skills.base import Event, SkillContext, ToolResult

logger = logging.getLogger(__name__)

MANIFEST_ID = "df-app-manifest"
MAX_HTML_BYTES = 1_000_000
MAX_TABLES = 20
MAX_TITLE_CHARS = 80

_MANIFEST_RE = re.compile(
    r"<script\b[^>]*\bid\s*=\s*[\"']?" + MANIFEST_ID + r"[\"']?[^>]*>.*?</script\s*>",
    re.IGNORECASE | re.DOTALL,
)
_HEAD_OPEN_RE = re.compile(r"<head\b[^>]*>", re.IGNORECASE)
_HTML_OPEN_RE = re.compile(r"<html\b[^>]*>", re.IGNORECASE)

_LINT_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b(?:src|href)\s*=\s*[\"']?\s*(?:https?:)?//", re.IGNORECASE),
     "External scripts, stylesheets, fonts, and images are blocked; inline them or use DF.chart."),
    (re.compile(r"(?:@import|url\(\s*[\"']?)\s*(?:https?:)?//", re.IGNORECASE),
     "External CSS imports and url() assets are blocked; use inline styles and data: URIs."),
    (re.compile(r"\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bsendBeacon\b"),
     "Network requests are blocked; read workspace data with DF.query or DF.table."),
    (re.compile(r"\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie"),
     "Browser storage is unavailable in the sandbox; keep app state in memory."),
    (re.compile(r"\b(?:alert|confirm|prompt)\s*\("),
     "Dialogs (alert, confirm, prompt) are blocked; render messages in the page."),
    (re.compile(r"<form\b[^>]*\baction\s*=", re.IGNORECASE),
     "Form submission is blocked; handle input events in JavaScript."),
)


def _invalid_filename(filename: Any) -> str | None:
    if (not isinstance(filename, str) or not filename.strip() or filename != filename.strip()
            or len(filename.encode("utf-8")) > 255 or filename.startswith((".", "_"))
            or any(character in "/\\" or ord(character) < 32 for character in filename)):
        return "filename must be a visible filename without directories"
    if not filename.lower().endswith(".html"):
        return "filename must end with .html"
    return None


def _invalid_title(title: Any) -> str | None:
    if (not isinstance(title, str) or not title.strip() or len(title.strip()) > MAX_TITLE_CHARS
            or any(ord(character) < 32 or ord(character) == 127 for character in title)):
        return f"title must be a non-empty single-line title of at most {MAX_TITLE_CHARS} characters"
    return None


def build_manifest(title: str, tables: list[str]) -> dict[str, Any]:
    return {"version": 1, "title": title, "tables": tables}


def inject_manifest(html: str, manifest: dict[str, Any]) -> str:
    """Replace any existing app manifest with ``manifest`` inside ``<head>``."""
    payload = json.dumps(manifest, ensure_ascii=False).replace("</", "<\\/")
    tag = f'<script type="application/json" id="{MANIFEST_ID}">{payload}</script>'
    html = _MANIFEST_RE.sub("", html)
    head = _HEAD_OPEN_RE.search(html)
    if head:
        return f"{html[:head.end()]}\n{tag}{html[head.end():]}"
    root = _HTML_OPEN_RE.search(html)
    if root:
        return f"{html[:root.end()]}\n<head>\n{tag}\n</head>{html[root.end():]}"
    return f"{tag}\n{html}"


def lint_html(html: str, tables: list[str]) -> list[str]:
    warnings = [message for pattern, message in _LINT_RULES if pattern.search(html)]
    if tables and "DF." not in html:
        warnings.append("The app declares tables but never calls the DF runtime; load data with DF.query or DF.table.")
    return warnings


class HtmlAppSkill:
    """Behaviour for the ``write_html_app`` action (schemas in ``tools.json``)."""

    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        return ToolResult(text=f"html_app has no tool '{name}'.")

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action != "write_html_app":
            yield {"type": "error", "message": f"html_app cannot handle action '{action}'.",
                   "message_code": "agent.unknownAction"}
            return f"html_app cannot handle action '{action}'."
        try:
            file, warnings, tables = self._write(spec, ctx)
        except (ValueError, FileNotFoundError) as error:
            message = f"write_html_app failed: {error}"
            yield {"type": "error", "message": message, "message_code": "agent.parseActionFailed"}
            return f"[HTML APP NOT CREATED] {error}"

        yield {"type": "action", "action": "write_html_app", "file": file}
        return json.dumps({
            "status": "delivered",
            "message": "The app was saved and opened on the canvas.",
            **{key: file[key] for key in ("name", "path", "display_name", "content_hash")},
            "tables": tables,
            "warnings": warnings,
            "revise_with": "edit_file using this path and content_hash; keep the df-app-manifest script.",
        }, ensure_ascii=False)

    def _write(self, spec: dict[str, Any], ctx: SkillContext) -> tuple[dict[str, Any], list[str], list[str]]:
        filename = spec.get("filename")
        title = spec.get("title")
        html = spec.get("html")
        tables = spec.get("tables", [])
        for problem in (_invalid_filename(filename), _invalid_title(title)):
            if problem:
                raise ValueError(problem)
        if not isinstance(html, str) or not html.strip():
            raise ValueError("html must be a non-empty HTML document")
        if "\x00" in html:
            raise ValueError("html must not contain null bytes")
        if not isinstance(tables, list) or not all(isinstance(table, str) and table for table in tables):
            raise ValueError("tables must be a list of workspace table names")
        tables = list(dict.fromkeys(tables))
        if len(tables) > MAX_TABLES:
            raise ValueError(f"declare at most {MAX_TABLES} tables")
        if ctx.workspace is None:
            raise ValueError("No workspace is available")
        available = set(ctx.workspace.list_tables())
        missing = [table for table in tables if table not in available]
        if missing:
            listed = ", ".join(sorted(available)[:30]) or "none"
            raise ValueError(
                f"Unknown workspace tables: {', '.join(missing)}. Load or create them first. Available: {listed}"
            )

        title = title.strip()
        document = inject_manifest(html, build_manifest(title, tables))
        encoded = document.encode("utf-8")
        if len(encoded) > MAX_HTML_BYTES:
            raise ValueError(
                f"The app is {len(encoded):,} bytes; keep it under {MAX_HTML_BYTES:,} bytes and read data with DF.query instead of embedding it"
            )
        metadata = ctx.workspace.save_workspace_file(
            encoded, filename, "text/html", display_name=title, agent_managed=True,
        )
        try:
            from data_formulator.analyst.workspace_inputs import WorkspaceInputEngine
            ctx.payload["workspace_inputs"] = WorkspaceInputEngine(
                ctx.workspace, ctx.payload.get("input_tables", []),
            ).manifest
        except Exception:
            logger.warning("Could not refresh workspace inputs after write_html_app", exc_info=True)
        file = {
            "name": metadata.name,
            "path": f"files/{metadata.name}",
            "display_name": metadata.display_name or title,
            "content_hash": metadata.content_hash,
            "file_size": len(encoded),
            "url": f"/api/workspace/files/{quote(metadata.name, safe='')}",
        }
        return file, lint_html(html, tables), tables


def get_skill() -> HtmlAppSkill:
    return HtmlAppSkill()
