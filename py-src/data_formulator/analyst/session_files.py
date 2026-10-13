"""The session as files (design-docs/60): one view the agent lists, reads, and searches.

- ``files/<path>``: workspace files, in folders.
- ``session/<path>``: the session's state as files, from the snapshot the
  application sends with the request (``session_files``): charts and reports the
  agent may edit, tables and threads it may read.
- ``scratch/<path>``: execution intermediates and terminal output.

Data tables are read with the data tools, not here.
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterator

MAX_TEXT_BYTES = 2_000_000
READ_LINES = 400
MAX_BATCH_FILES = 20
MAX_BATCH_CHARS = 60_000
MAX_MATCHES = 100
MAX_LISTED = 500
_TEXT_SUFFIXES = (
    ".md", ".markdown", ".txt", ".csv", ".tsv", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".py", ".sql", ".r", ".js", ".jsx", ".ts", ".tsx", ".html", ".htm", ".css", ".xml", ".svg", ".log", ".sh",
)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def helper_module_name(path: str) -> str | None:
    """The module a Python helper file imports as (``files/lib/clean.py`` -> ``lib.clean``), or None."""
    if not path.startswith("files/") or not path.endswith(".py"):
        return None
    parts = path[len("files/"):-len(".py")].split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts) if parts and all(part.isidentifier() for part in parts) else None


@dataclass
class Entry:
    path: str
    size: int | None
    editable: bool
    display_name: str | None = None
    note: str | None = None


class SessionFiles:
    """The files of one run's session (``ctx``: workspace + payload)."""

    def __init__(self, ctx: Any):
        self.workspace = getattr(ctx, "workspace", None)
        self.payload = getattr(ctx, "payload", None) or {}

    # -- session/ snapshot ---------------------------------------------------

    @property
    def layer(self):
        from data_formulator.analyst.session_layer import session_layer
        return session_layer(self.payload)

    def session_view(self, path: str) -> dict[str, Any] | None:
        layer = self.layer
        return layer.view(path) if layer is not None else None

    # -- listing -------------------------------------------------------------

    def entries(self) -> Iterator[Entry]:
        if self.workspace is not None:
            for item in sorted(self.workspace.list_workspace_files(), key=lambda item: item.name.lower()):
                module = helper_module_name(f"files/{item.name}")
                note = None
                if module:
                    note = f"importable as {module}" if getattr(item, "code_signature", None) else \
                        "not importable until you save it (uploaded or edited by the user)"
                yield Entry(f"files/{item.name}", item.file_size,
                            item.origin == "agent" and item.edit_policy == "agent_editable",
                            item.display_name, note)
        layer = self.layer
        for path in layer.paths() if layer is not None else []:
            # Views are built when read; listing names them without building them.
            editable = path.startswith(("session/charts/", "session/reports/"))
            yield Entry(path, None, editable)
        if self.workspace is not None:
            for path in self.workspace.list_scratch_files():
                try:
                    size = self.workspace.resolve_scratch_file(path[len("scratch/"):]).stat().st_size
                except (OSError, ValueError):
                    continue
                yield Entry(path, size, False)

    def list(self, path: str = "") -> dict[str, Any]:
        prefix = _prefix(path)
        listed = [entry for entry in self.entries() if entry.path.startswith(prefix)]
        items = [{"path": entry.path, **({"size": entry.size} if entry.size is not None else {}),
                  **({"editable": True} if entry.editable else {}),
                  **({"name": entry.display_name} if entry.display_name else {}),
                  **({"note": entry.note} if entry.note else {})} for entry in listed[:MAX_LISTED]]
        return {"path": prefix or "", "count": len(listed), "files": items,
                **({"truncated": True} if len(listed) > MAX_LISTED else {})}

    # -- reading -------------------------------------------------------------

    def text(self, path: str) -> str:
        """A file's full text; raises ``FileNotFoundError`` or ``ValueError`` (not text)."""
        path = _normalize(path)
        if path.startswith("session/"):
            item = self.session_view(path)
            if item is None:
                raise FileNotFoundError(path)
            return str(item.get("content", ""))
        if self.workspace is None:
            raise FileNotFoundError(path)
        if path.startswith("files/"):
            try:
                _, content = self.workspace.read_workspace_file(path[len("files/"):])
            except (FileNotFoundError, KeyError):
                raise FileNotFoundError(path) from None
        elif path.startswith("scratch/"):
            try:
                content = self.workspace.resolve_scratch_file(path[len("scratch/"):]).read_bytes()
            except (OSError, ValueError):
                raise FileNotFoundError(path) from None
        else:
            raise FileNotFoundError(path)
        return _decode(path, content)

    def read(self, path: str, offset: int = 1, limit: int = READ_LINES) -> dict[str, Any]:
        path = _normalize(path)
        if not isinstance(offset, int) or offset < 1:
            raise ValueError("offset is the first line to read, starting at 1")
        if not isinstance(limit, int) or not 1 <= limit <= 2000:
            raise ValueError("limit must be between 1 and 2000 lines")
        try:
            text = self.text(path)
        except FileNotFoundError:
            raise ValueError(f"{path} does not exist. Use list_files to see the session's files.") from None
        lines = text.splitlines(keepends=True)
        chunk = lines[offset - 1:offset - 1 + limit]
        editable = self._editable(path)
        result: dict[str, Any] = {
            "path": path, "content": "".join(chunk), "start_line": offset,
            "end_line": offset - 1 + len(chunk), "total_lines": len(lines),
            "content_hash": content_hash(text) if path.startswith("session/") else self._file_hash(path, text),
            **({"editable": True} if editable else {}),
        }
        if offset - 1 + len(chunk) < len(lines):
            result["more"] = f"Read on with offset={offset + len(chunk)}."
        note = (self.session_view(path) or {}).get("note") if path.startswith("session/") else None
        if note:
            result["note"] = note
        return result

    def read_many(self, paths: Any, limit: int = READ_LINES) -> dict[str, Any]:
        """Several files at once (paths or globs such as ``session/charts/*``), within one size budget."""
        if not isinstance(paths, list) or not paths or not all(isinstance(path, str) for path in paths):
            raise ValueError("paths is a list of file paths or globs, e.g. [\"session/charts/*\", \"session/tables/sales.json\"]")
        wanted: list[str] = []
        unmatched = []
        for pattern in paths:
            if any(char in pattern for char in "*?["):
                glob = _normalize(pattern)
                found = [entry.path for entry in self.entries() if fnmatch.fnmatch(entry.path, glob)]
                unmatched += [] if found else [pattern]
                wanted += found
            else:
                wanted.append(_normalize(pattern))
        wanted = list(dict.fromkeys(wanted))
        files: list[dict[str, Any]] = []
        used = 0
        for index, path in enumerate(wanted):
            if index >= MAX_BATCH_FILES:
                files.append({"path": path, "not_read": f"more than {MAX_BATCH_FILES} files; read it separately"})
                continue
            try:
                result = self.read(path, 1, limit)
            except ValueError as error:
                files.append({"path": path, "error": str(error)})
                continue
            size = len(result["content"])
            if used + size > MAX_BATCH_CHARS and files:
                files.append({"path": path, "not_read": "over this call's size budget; read it separately"})
                continue
            used += size
            files.append(result)
        response: dict[str, Any] = {"files": files}
        if unmatched:
            response["no_match"] = unmatched
        return response

    def _file_hash(self, path: str, text: str) -> str:
        if path.startswith("files/") and self.workspace is not None:
            item = self.workspace.get_metadata().files.get(path[len("files/"):])
            if item is not None:
                return item.content_hash
        return content_hash(text)

    def _editable(self, path: str) -> bool:
        if path.startswith("session/"):
            return bool((self.session_view(path) or {}).get("editable"))
        if path.startswith("files/") and self.workspace is not None:
            item = self.workspace.get_metadata().files.get(path[len("files/"):])
            return bool(item and item.origin == "agent" and item.edit_policy == "agent_editable")
        return False

    # -- searching -----------------------------------------------------------

    def search(self, pattern: str, path: str = "", *, regex: bool = False, case_sensitive: bool = False,
               glob: str | None = None, max_results: int = 50) -> dict[str, Any]:
        if not isinstance(pattern, str) or not pattern:
            raise ValueError("pattern is required")
        if not isinstance(max_results, int) or not 1 <= max_results <= MAX_MATCHES:
            raise ValueError(f"max_results must be between 1 and {MAX_MATCHES}")
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            matcher = re.compile(pattern if regex else re.escape(pattern), flags)
        except re.error as error:
            raise ValueError(f"Invalid regular expression: {error}") from None
        prefix = _prefix(path)
        matches: list[dict[str, Any]] = []
        searched = matched_files = 0
        skipped = []
        for entry in self.entries():
            if not entry.path.startswith(prefix) or (glob and not fnmatch.fnmatch(entry.path, glob)):
                continue
            if entry.size is not None and entry.size > MAX_TEXT_BYTES:
                skipped.append(entry.path)
                continue
            try:
                text = self.text(entry.path)
            except (ValueError, FileNotFoundError):
                continue
            searched += 1
            found = False
            for number, line in enumerate(text.splitlines(), start=1):
                if matcher.search(line):
                    found = True
                    if len(matches) < max_results:
                        matches.append({"path": entry.path, "line": number, "text": line.strip()[:300]})
            matched_files += found
        result: dict[str, Any] = {"pattern": pattern, "files_searched": searched, "files_matched": matched_files,
                                  "matches": matches}
        if len(matches) >= max_results:
            result["truncated"] = "More matches exist; narrow the path or pattern."
        if skipped:
            result["skipped_large_files"] = skipped[:10]
        return result


def _normalize(path: Any) -> str:
    if not isinstance(path, str) or not path.strip():
        raise ValueError("path is required, e.g. files/notes/plan.md or session/charts/<id>.json")
    path = path.strip().lstrip("/")
    if path.split("/")[0] not in ("files", "session", "scratch") or ".." in path.split("/"):
        raise ValueError(f"{path} is not a session file; paths start with files/, session/, or scratch/")
    return path


def _prefix(path: Any) -> str:
    if path in (None, "", "/"):
        return ""
    prefix = _normalize(path)
    return prefix if prefix.endswith("/") or "." in prefix.rsplit("/", 1)[-1] else prefix + "/"


def _decode(path: str, content: bytes) -> str:
    if len(content) > MAX_TEXT_BYTES:
        raise ValueError(f"{path} is larger than {MAX_TEXT_BYTES:,} bytes; read it with Python")
    if b"\x00" in content and not path.lower().endswith(_TEXT_SUFFIXES):
        raise ValueError(f"{path} is not a text file; read it with Python or the data tools")
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError(f"{path} is not UTF-8 text; read it with Python or the data tools") from None


NOTES_FOLDER = "notes/"
MAX_NOTE_CHARS = 4000
MAX_NOTES_CHARS = 12000


def render_session_notes(workspace: Any) -> str:
    """The ``[SESSION NOTES]`` block: the agent's notes in ``files/notes/``, so decisions carry across turns."""
    if workspace is None:
        return ""
    try:
        notes = sorted((item for item in workspace.list_workspace_files() if item.name.startswith(NOTES_FOLDER)),
                       key=lambda item: item.name)
    except Exception:
        return ""
    if not notes:
        return ""
    lines = ["[SESSION NOTES]",
             "Your working notes for this session (files/notes/); keep them current with edit_file."]
    used = 0
    for item in notes:
        try:
            _, content = workspace.read_workspace_file(item.name)
            text = _decode(f"files/{item.name}", content)
        except Exception:
            lines.append(f"\n## files/{item.name} (not text)")
            continue
        room = min(MAX_NOTE_CHARS, MAX_NOTES_CHARS - used)
        if room <= 0:
            lines.append(f"\n## files/{item.name} (not shown; read_file it)")
            continue
        shown = text[:room]
        used += len(shown)
        more = f"\n… ({len(text) - room:,} more characters; read_file it)" if len(text) > room else ""
        lines.append(f"\n## files/{item.name} (content_hash {item.content_hash})\n{shown.rstrip()}{more}")
    return "\n".join(lines)


MAX_INLINE_CHARS = 8000
MAX_THREAD_CHARS = 6000
MAX_TABLE_CHARS = 5000
MAX_TABLES_CHARS = 10000


def _inline(label: str, path: str, files: "SessionFiles", limit: int, tail: bool = False) -> str | None:
    try:
        read = files.read(path, 1, 2000)
    except ValueError:
        return None
    text = read["content"]
    meta = f"content_hash {read['content_hash']}" + (", you can edit it" if read.get("editable") else "")
    if read.get("note"):
        meta += f". {read['note']}"
    if len(text) > limit:
        if tail:
            head, _, body = text.partition("\n")
            text = head + "\n… (earlier steps: read_file " + path + ")\n" + body[-(limit - len(head)):].split("\n", 1)[-1]
        else:
            text = text[:limit] + f"\n… ({len(text) - limit:,} more characters: read_file {path})"
    return f"{label} `{path}` ({meta})\n{text.rstrip()}"


def render_turn_context(ctx: Any, history: list[dict[str, Any]]) -> str:
    """What a continued request adds to the conversation (design-docs/63): what changed since the agent last
    looked and where the user is now; what is on the canvas when it is new or changed, with the data behind it
    the conversation has not seen; the thread's latest steps when the user moved to another thread; and the
    notes when they changed."""
    from data_formulator.analyst.session_layer import session_layer
    from data_formulator.analyst.session_layer.layer import seen_versions

    layer = session_layer(getattr(ctx, "payload", None))
    if layer is None:
        return ""
    seen = seen_versions(history)
    parts = [layer.changes(seen, always_focus=True)]
    current = layer.versions
    path, thread = layer.focus()
    files = SessionFiles(ctx)
    said = json.dumps(history, ensure_ascii=False, default=str)
    if path and (seen.get("@focus") != path or seen.get(path) != current.get(path)):
        parts.append(_inline("[ON THE CANVAS]", path, files, MAX_INLINE_CHARS))
        room = MAX_TABLES_CHARS
        for table in layer.tables_behind(path):
            # Tables the conversation already has (the agent made or read them) are not repeated.
            name = table.rsplit("/", 1)[-1][:-len(".json")]
            if room <= 0 or re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", said):
                continue
            block = _inline("[ITS DATA]", table, files, min(MAX_TABLE_CHARS, room))
            if block:
                parts.append(block)
                room -= len(block)
    thread_path = f"session/threads/{thread}.md" if thread else None
    focus_lines = [line for line in said.replace("\\n", "\n").split("\n") if line.startswith("Focus: ")]
    if thread_path and (not focus_lines or thread_path not in focus_lines[-1]):
        parts.append(_inline("[THE THREAD YOU ARE CONTINUING]", thread_path, files, MAX_THREAD_CHARS, tail=True))
    if any(name.startswith("files/" + NOTES_FOLDER) and current.get(name) != seen.get(name) for name in current):
        parts.append(render_session_notes(getattr(ctx, "workspace", None)))
    return "\n\n".join(part for part in parts if part)


def render_session_context(ctx: Any, *, focus: bool = True) -> str:
    """What a request shows of the session (design-docs/61): the index, the notes, what is on the canvas,
    and the latest steps of the thread being continued, each as the file it is. Runs not started from the
    canvas (workflows) leave out the focus."""
    from data_formulator.analyst.session_layer import session_layer

    layer = session_layer(getattr(ctx, "payload", None))
    workspace = getattr(ctx, "workspace", None)
    parts = []
    if layer is not None:
        parts.append("[SESSION INDEX]\n" + layer.index().rstrip())
    notes = render_session_notes(workspace)
    if notes:
        parts.append(notes)
    if layer is not None and focus:
        files = SessionFiles(ctx)
        path, thread = layer.focus()
        if path:
            parts.append(_inline("[ON THE CANVAS]", path, files, MAX_INLINE_CHARS))
            # The data behind a chart or table on the canvas, which most follow-ups read first.
            room = MAX_TABLES_CHARS
            for table in layer.tables_behind(path):
                if room <= 0:
                    break
                block = _inline("[ITS DATA]", table, files, min(MAX_TABLE_CHARS, room))
                if block:
                    parts.append(block)
                    room -= len(block)
        if thread:
            parts.append(_inline("[THE THREAD YOU ARE CONTINUING]", f"session/threads/{thread}.md", files,
                                 MAX_THREAD_CHARS, tail=True))
    return "\n\n".join(part for part in parts if part)
