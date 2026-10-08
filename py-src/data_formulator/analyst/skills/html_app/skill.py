# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""html_app skill — writes an interactive app as a workspace file.

Two committing actions share one flow: ``write_app`` saves a React app
(``*.app.jsx``, design-docs/57) and ``write_html_app`` a plain HTML app. The
handler validates the request, stamps a manifest declaring which workspace
tables the app may read (a ``// @df-app`` header line or a ``df-app-manifest``
script), and saves an agent-managed workspace file. Revisions update the same
file: a full rewrite passes ``path`` and ``expected_content_hash`` to the same
action, and targeted ``edit_file`` patches are validated by
``check_app_revision`` so a broken edit is refused.

The frontend renders the file in an opaque-origin sandboxed iframe with a
restrictive CSP and injects the DF runtime; the app reads declared tables through
a host bridge. Nothing here is a security boundary — the sandbox is. The lint
warnings returned to the model only steer it away from code that cannot work in
the sandbox (network calls, external assets, browser storage).

  - ``{"type": "action", "action": "write_app" | "write_html_app", "file": {...}}``
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
MAX_APP_BYTES = 500_000

REACT_APP_SUFFIX = ".app.jsx"
# Modules the sandboxed React runtime provides (src/app/reactApp/compile.ts ALLOWED_IMPORTS).
ALLOWED_IMPORTS = ("react", "react/jsx-runtime", "@df/ui", "@df/data", "@df/chart", "@df/format", "@df/icons", "@mui/material")
_REACT_MANIFEST_RE = re.compile(r"^[ \t]*//[ \t]*@df-app\b.*(?:\r?\n|$)", re.MULTILINE)
_IMPORT_FROM_RE = re.compile(r"^\s*(?:import|export)\s[^'\";]*?\bfrom\s*['\"]([^'\"]+)['\"]", re.MULTILINE)
_BARE_IMPORT_RE = re.compile(r"^\s*import\s*['\"]([^'\"]+)['\"]", re.MULTILINE)
_REQUIRE_RE = re.compile(r"\b(?:require|import)\s*\(\s*['\"]([^'\"]+)['\"]\s*\)")
_DEFAULT_EXPORT_RE = re.compile(r"^\s*export\s+default\b", re.MULTILINE)
_HEX_COLOR_RE = re.compile(r"['\"]#[0-9a-fA-F]{3,8}['\"]")

_MANIFEST_RE = re.compile(
    r"<script\b[^>]*\bid\s*=\s*[\"']?" + MANIFEST_ID + r"[\"']?[^>]*>(.*?)</script\s*>",
    re.IGNORECASE | re.DOTALL,
)
_REACT_MANIFEST_LINE_RE = re.compile(r"\A\s*//[ \t]*@df-app[ \t]+(\{.*\})[ \t]*(?:\r?\n|\Z)")
_CONTENT_HASH_RE = re.compile(r"^[0-9a-f]{64}$")
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


_STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>(.*?)</style\s*>", re.IGNORECASE | re.DOTALL)
_STYLE_ATTR_RE = re.compile(r"\bstyle\s*=\s*(\"[^\"]*\"|'[^']*')", re.IGNORECASE)
_COLOR_LITERAL_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\([^)]*\)")
_FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;}\"']+)", re.IGNORECASE)
_KIT_CLASS_RE = re.compile(r"\bclass\s*=\s*[\"'][^\"']*\bdf-", re.IGNORECASE)
MAX_COLOR_LITERALS = 3


def _invalid_filename(filename: Any, suffix: str = ".html") -> str | None:
    if (not isinstance(filename, str) or not filename.strip() or filename != filename.strip()
            or len(filename.encode("utf-8")) > 255 or filename.startswith((".", "_"))
            or any(character in "/\\" or ord(character) < 32 for character in filename)):
        return "filename must be a visible filename without directories"
    if not filename.lower().endswith(suffix):
        return f"filename must end with {suffix}"
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
    css = "\n".join(_STYLE_BLOCK_RE.findall(html) + _STYLE_ATTR_RE.findall(html))
    colors = sorted({color.lower().replace(" ", "") for color in _COLOR_LITERAL_RE.findall(css)})
    if len(colors) > MAX_COLOR_LITERALS:
        warnings.append(
            f"The CSS hardcodes {len(colors)} colors ({', '.join(colors[:5])}); use the --df-* theme tokens "
            "so the app matches Data Formulator."
        )
    families = [family.strip().lower() for family in _FONT_FAMILY_RE.findall(css)]
    if any("var(--df-font" not in family and family not in ("inherit", "monospace") for family in families):
        warnings.append("Custom font-family declarations override the Data Formulator font; remove them.")
    if not _KIT_CLASS_RE.search(html):
        warnings.append(
            "The app does not use the DF app kit; compose it from df-app, df-header, df-toolbar, df-card, "
            "df-kpis, and df-chart instead of custom styling."
        )
    return warnings


def stamp_react_manifest(code: str, manifest: dict[str, Any]) -> str:
    """Put the manifest on the first line as ``// @df-app {...}``, replacing any existing header."""
    body = _REACT_MANIFEST_RE.sub("", code).lstrip("\r\n")
    return f"// @df-app {json.dumps(manifest, ensure_ascii=False)}\n{body}"


def react_imports(code: str) -> list[str]:
    found = _IMPORT_FROM_RE.findall(code) + _BARE_IMPORT_RE.findall(code) + _REQUIRE_RE.findall(code)
    return list(dict.fromkeys(found))


def validate_react_app(code: str) -> None:
    """Reject code the sandboxed runtime cannot run: unknown imports or no default export."""
    disallowed = [name for name in react_imports(code) if name not in ALLOWED_IMPORTS]
    if disallowed:
        allowed = ", ".join(name for name in ALLOWED_IMPORTS if name != "react/jsx-runtime")
        raise ValueError(f"Cannot import {', '.join(disallowed)}; apps can import only {allowed}")
    if not _DEFAULT_EXPORT_RE.search(code):
        raise ValueError("The app must `export default` a React component")


def lint_react_app(code: str, tables: list[str]) -> list[str]:
    warnings = [message for pattern, message in _LINT_RULES if pattern.search(code)]
    if tables and not re.search(r"\b(?:useQuery|useDistinct|useTable)\s*\(", code):
        warnings.append("The app declares tables but never reads them; use useQuery, useDistinct, or useTable from @df/data.")
    colors = sorted({color.strip("'\"").lower() for color in _HEX_COLOR_RE.findall(code)})
    if len(colors) > MAX_COLOR_LITERALS:
        warnings.append(
            f"The app hardcodes {len(colors)} colors ({', '.join(colors[:5])}); use theme colors such as "
            "'primary.main' or 'text.secondary', and the Kpi/Callout tones, so the app matches Data Formulator."
        )
    return warnings


def _declared_tables(spec: dict[str, Any], ctx: SkillContext) -> list[str]:
    tables = spec.get("tables", [])
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
    return tables


def _app_target(spec: dict[str, Any], suffix: str, ctx: SkillContext) -> tuple[str, str | None]:
    """Resolve the file a write targets: a new ``filename`` or an existing ``path`` plus its hash."""
    path = spec.get("path")
    expected = spec.get("expected_content_hash")
    if path is None:
        filename = spec.get("filename")
        problem = _invalid_filename(filename, suffix)
        if problem:
            raise ValueError(problem)
        if expected is not None:
            raise ValueError("expected_content_hash is only for revisions; pass path with it")
        if ctx.workspace is not None and any(item.name == filename for item in ctx.workspace.list_workspace_files()):
            raise ValueError(
                f"files/{filename} already exists; to revise it pass path=\"files/{filename}\" and its "
                "expected_content_hash, or use edit_file for small changes"
            )
        return filename, None
    if not isinstance(path, str) or not path.startswith("files/"):
        raise ValueError("path must be the files/... path of an existing app")
    filename = path.removeprefix("files/")
    problem = _invalid_filename(filename, suffix)
    if problem:
        raise ValueError(problem.replace("filename", "path"))
    if spec.get("filename") not in (None, filename):
        raise ValueError("Give filename for a new app or path for an existing app, not both")
    if not isinstance(expected, str) or not _CONTENT_HASH_RE.match(expected):
        raise ValueError("expected_content_hash must be the app's current SHA-256 content hash")
    return filename, expected


def read_react_manifest(code: str) -> dict[str, Any] | None:
    match = _REACT_MANIFEST_LINE_RE.match(code)
    if not match:
        return None
    try:
        manifest = json.loads(match.group(1))
    except ValueError:
        return None
    return manifest if isinstance(manifest, dict) else None


def read_html_manifest(html: str) -> dict[str, Any] | None:
    match = _MANIFEST_RE.search(html)
    if not match:
        return None
    try:
        manifest = json.loads(match.group(1))
    except ValueError:
        return None
    return manifest if isinstance(manifest, dict) else None


def check_app_revision(filename: str, original: str | None, content: Any, ctx: SkillContext) -> dict[str, Any] | None:
    """Validate an ``edit_file`` revision of an app like ``write_app`` validates a new one.

    Returns ``None`` for files that are not apps, otherwise ``{"title", "tables",
    "warnings"}``. Raises ``ValueError`` (prefixed ``[APP NOT UPDATED]``) so a broken
    edit is refused and the previous version stays on disk.
    """
    lower = filename.lower()
    react = lower.endswith(REACT_APP_SUFFIX)
    html_app = lower.endswith((".html", ".htm")) and any(
        isinstance(text, str) and _MANIFEST_RE.search(text) for text in (original, content))
    if not react and not html_app:
        return None
    try:
        if not isinstance(content, str):
            raise ValueError("An app must be UTF-8 text")
        if react:
            manifest = read_react_manifest(content)
            if manifest is None:
                raise ValueError(
                    "Keep the first-line `// @df-app {\"version\": 2, \"title\": ..., \"tables\": [...]}` manifest; "
                    "it declares the app's title and the tables it may read"
                )
            validate_react_app(content)
            limit = MAX_APP_BYTES
        else:
            manifest = read_html_manifest(content)
            if manifest is None:
                raise ValueError(f"Keep the <script type=\"application/json\" id=\"{MANIFEST_ID}\"> manifest in <head>")
            limit = MAX_HTML_BYTES
        title = manifest.get("title")
        problem = _invalid_title(title)
        if problem:
            raise ValueError(f"manifest {problem}")
        tables = _declared_tables({"tables": manifest.get("tables", [])}, ctx)
        size = len(content.encode("utf-8"))
        if size > limit:
            raise ValueError(f"The app is {size:,} bytes; keep it under {limit:,} bytes")
    except ValueError as error:
        raise ValueError(f"[APP NOT UPDATED] {error}") from error
    warnings = lint_react_app(content, tables) if react else lint_html(content, tables)
    return {"title": title.strip(), "tables": tables, "warnings": warnings}


def _save_app(ctx: SkillContext, encoded: bytes, filename: str, media_type: str, title: str,
              expected_hash: str | None = None) -> dict[str, Any]:
    try:
        metadata = ctx.workspace.save_workspace_file(
            encoded, filename, media_type, display_name=title, agent_managed=True,
            expected_content_hash=expected_hash,
        )
    except FileNotFoundError as error:
        raise ValueError(f"files/{filename} does not exist; create a new app with filename instead") from error
    try:
        from data_formulator.analyst.workspace_inputs import WorkspaceInputEngine
        ctx.payload["workspace_inputs"] = WorkspaceInputEngine(
            ctx.workspace, ctx.payload.get("input_tables", []),
        ).manifest
    except Exception:
        logger.warning("Could not refresh workspace inputs after writing an app", exc_info=True)
    return {
        "name": metadata.name,
        "path": f"files/{metadata.name}",
        "display_name": metadata.display_name or title,
        "content_hash": metadata.content_hash,
        "file_size": len(encoded),
        "url": f"/api/workspace/files/{quote(metadata.name, safe='')}",
    }


class HtmlAppSkill:
    """Behaviour for the ``write_app`` and ``write_html_app`` actions (schemas in ``tools.json``)."""

    def handle_tool(self, name: str, args: dict[str, Any], ctx: SkillContext) -> ToolResult:
        return ToolResult(text=f"html_app has no tool '{name}'.")

    def handle_action(
        self,
        action: str,
        spec: dict[str, Any],
        ctx: SkillContext,
    ) -> Generator[Event, None, str | None]:
        if action not in ("write_app", "write_html_app"):
            yield {"type": "error", "message": f"html_app cannot handle action '{action}'.",
                   "message_code": "agent.unknownAction"}
            return f"html_app cannot handle action '{action}'."
        react = action == "write_app"
        updating = spec.get("path") is not None
        try:
            file, warnings, tables = self._write_react(spec, ctx) if react else self._write_html(spec, ctx)
        except (ValueError, FileNotFoundError) as error:
            message = f"{action} failed: {error}"
            yield {"type": "error", "message": message, "message_code": "agent.parseActionFailed"}
            return f"[{'APP' if react else 'HTML APP'} NOT {'UPDATED' if updating else 'CREATED'}] {error}"

        yield {"type": "action", "action": action, "file": file, "updated": updating}
        return json.dumps({
            "status": "updated" if updating else "delivered",
            "message": f"The app was {'updated' if updating else 'saved'} and opened on the canvas.",
            **{key: file[key] for key in ("name", "path", "display_name", "content_hash")},
            "tables": tables,
            "warnings": warnings,
            "revise_with": (
                "Small changes: edit_file with this path and content_hash (targeted replacements), keeping the "
                + ("first-line // @df-app manifest." if react else "df-app-manifest script.")
                + f" Larger rewrites: {action} with path and expected_content_hash."
            ),
        }, ensure_ascii=False)

    def _write_react(self, spec: dict[str, Any], ctx: SkillContext) -> tuple[dict[str, Any], list[str], list[str]]:
        filename, expected_hash = _app_target(spec, REACT_APP_SUFFIX, ctx)
        title = spec.get("title")
        code = spec.get("code")
        problem = _invalid_title(title)
        if problem:
            raise ValueError(problem)
        if not isinstance(code, str) or not code.strip():
            raise ValueError("code must be the complete app source")
        if "\x00" in code:
            raise ValueError("code must not contain null bytes")
        validate_react_app(code)
        tables = _declared_tables(spec, ctx)
        title = title.strip()
        encoded = stamp_react_manifest(code, {"version": 2, "title": title, "tables": tables}).encode("utf-8")
        if len(encoded) > MAX_APP_BYTES:
            raise ValueError(
                f"The app is {len(encoded):,} bytes; keep it under {MAX_APP_BYTES:,} bytes and read data with useQuery instead of embedding it"
            )
        file = _save_app(ctx, encoded, filename, "text/jsx", title, expected_hash)
        return file, lint_react_app(code, tables), tables

    def _write_html(self, spec: dict[str, Any], ctx: SkillContext) -> tuple[dict[str, Any], list[str], list[str]]:
        filename, expected_hash = _app_target(spec, ".html", ctx)
        title = spec.get("title")
        html = spec.get("html")
        problem = _invalid_title(title)
        if problem:
            raise ValueError(problem)
        if not isinstance(html, str) or not html.strip():
            raise ValueError("html must be a non-empty HTML document")
        if "\x00" in html:
            raise ValueError("html must not contain null bytes")
        tables = _declared_tables(spec, ctx)
        title = title.strip()
        document = inject_manifest(html, build_manifest(title, tables))
        encoded = document.encode("utf-8")
        if len(encoded) > MAX_HTML_BYTES:
            raise ValueError(
                f"The app is {len(encoded):,} bytes; keep it under {MAX_HTML_BYTES:,} bytes and read data with DF.query instead of embedding it"
            )
        file = _save_app(ctx, encoded, filename, "text/html", title, expected_hash)
        return file, lint_html(html, tables), tables


def get_skill() -> HtmlAppSkill:
    return HtmlAppSkill()
