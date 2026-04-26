# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Knowledge store — manages user knowledge files (rules, skills, experiences).

Each user has a ``knowledge/`` directory under their home with three
sub-directories: ``rules``, ``skills``, ``experiences``.  Every knowledge
entry is a Markdown file with YAML front matter.

All file I/O is routed through :class:`ConfinedDir` for path safety.

Directory depth constraints:

- ``rules``: flat — only files directly under ``rules/`` (1 path part)
- ``skills``: one level of sub-directories (up to 2 path parts)
- ``experiences``: one level of sub-directories (up to 2 path parts)
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from data_formulator.security.path_safety import ConfinedDir

logger = logging.getLogger(__name__)

VALID_CATEGORIES = frozenset({"rules", "skills", "experiences"})

_MAX_DEPTH = {
    "rules": 1,       # flat: only "file.md"
    "skills": 2,      # one sub-dir: "category/file.md"
    "experiences": 2,  # one sub-dir: "category/file.md"
}


# ---------------------------------------------------------------------------
# Front matter parsing
# ---------------------------------------------------------------------------

_FM_PATTERN = re.compile(
    r"\A---[ \t]*\r?\n(.*?\r?\n)---[ \t]*\r?\n?",
    re.DOTALL,
)


def parse_front_matter(content: str) -> tuple[dict[str, Any], str]:
    """Parse YAML front matter from *content*.

    Returns ``(metadata_dict, body_text)``.  On parse failure the metadata
    dict is empty and the full content is returned as the body (graceful
    degradation).
    """
    m = _FM_PATTERN.match(content)
    if not m:
        return {}, content

    try:
        import yaml  # noqa: delay import — only needed when parsing
        meta = yaml.safe_load(m.group(1))
        if not isinstance(meta, dict):
            return {}, content
    except Exception:
        return {}, content

    body = content[m.end():]
    return meta, body


def _ensure_front_matter(content: str, path: str) -> str:
    """If *content* lacks front matter, prepend a minimal header."""
    meta, _ = parse_front_matter(content)
    if meta:
        return content

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    stem = Path(path).stem
    header = (
        f"---\ntitle: {stem}\n"
        f"created: {today}\n"
        f"updated: {today}\n"
        f"source: manual\n---\n\n"
    )
    return header + content


# ---------------------------------------------------------------------------
# KnowledgeStore
# ---------------------------------------------------------------------------


class KnowledgeStore:
    """Manages the user's knowledge directory tree.

    Usage::

        store = KnowledgeStore(user_home)
        items = store.list_all("rules")
        content = store.read("skills", "data-cleaning/handle-missing.md")
        store.write("rules", "date-format.md", md_content)
        store.delete("rules", "date-format.md")
        results = store.search("ROI", categories=["rules", "skills"])
    """

    def __init__(self, user_home: Path | str) -> None:
        user_home = Path(user_home)
        self._root = ConfinedDir(user_home / "knowledge", mkdir=True)
        self._jails: dict[str, ConfinedDir] = {
            "rules": ConfinedDir(self._root.root / "rules", mkdir=True),
            "skills": ConfinedDir(self._root.root / "skills", mkdir=True),
            "experiences": ConfinedDir(self._root.root / "experiences", mkdir=True),
        }

    # -- path validation ---------------------------------------------------

    @staticmethod
    def validate_path(category: str, relative_path: str) -> None:
        """Validate that *relative_path* conforms to *category* depth rules.

        Raises ``ValueError`` on violation.
        """
        if category not in VALID_CATEGORIES:
            raise ValueError(f"Invalid category: {category!r}")

        if not relative_path:
            raise ValueError("Empty path")

        if not relative_path.endswith(".md"):
            raise ValueError("Knowledge files must be .md format")

        parts = Path(relative_path).parts
        max_depth = _MAX_DEPTH[category]
        if len(parts) > max_depth:
            if max_depth == 1:
                raise ValueError(f"{category} does not allow sub-directories")
            else:
                raise ValueError(
                    f"{category} allows at most one level of sub-directories"
                )

    def _jail(self, category: str) -> ConfinedDir:
        if category not in self._jails:
            raise ValueError(f"Invalid category: {category!r}")
        return self._jails[category]

    # -- CRUD --------------------------------------------------------------

    def list_all(self, category: str) -> list[dict[str, Any]]:
        """List all knowledge entries in *category*.

        Returns a list of dicts with ``title``, ``tags``, ``path``,
        ``source``, and ``created`` parsed from front matter.
        """
        jail = self._jail(category)
        items: list[dict[str, Any]] = []

        for md_file in sorted(jail.rglob("*.md")):
            try:
                raw = md_file.read_text(encoding="utf-8")
            except Exception:
                logger.warning("Failed to read knowledge file %s", md_file.name)
                continue

            meta, _ = parse_front_matter(raw)
            rel = str(md_file.relative_to(jail.root)).replace("\\", "/")
            items.append({
                "title": meta.get("title", md_file.stem),
                "tags": meta.get("tags", []),
                "path": rel,
                "source": meta.get("source", "manual"),
                "created": str(meta.get("created", "")),
            })

        return items

    def read(self, category: str, path: str) -> str:
        """Read the full content of a knowledge file."""
        self.validate_path(category, path)
        return self._jail(category).read_text(path)

    def write(self, category: str, path: str, content: str) -> Path:
        """Create or update a knowledge file.

        If *content* lacks YAML front matter, a minimal header is prepended.
        """
        self.validate_path(category, path)
        content = _ensure_front_matter(content, path)
        return self._jail(category).write_text(path, content)

    def delete(self, category: str, path: str) -> None:
        """Delete a knowledge file."""
        self.validate_path(category, path)
        self._jail(category).unlink(path)

    # -- search ------------------------------------------------------------

    def search(
        self,
        query: str,
        categories: list[str] | None = None,
        max_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Search across knowledge categories.

        Matching is case-insensitive substring against title, tags,
        file name (stem), and the first 200 characters of body text.
        Results are ranked: title > tags > filename > body.
        """
        if not query or not query.strip():
            return []

        q = query.strip().lower()
        cats = categories or list(VALID_CATEGORIES)
        scored: list[tuple[int, dict[str, Any]]] = []

        for cat in cats:
            if cat not in self._jails:
                continue
            jail = self._jails[cat]
            for md_file in jail.rglob("*.md"):
                try:
                    raw = md_file.read_text(encoding="utf-8")
                except Exception:
                    continue

                meta, body = parse_front_matter(raw)
                title = meta.get("title", md_file.stem)
                tags = meta.get("tags", [])
                if not isinstance(tags, list):
                    tags = [str(tags)]
                stem = md_file.stem
                body_prefix = body[:200]

                score = self._match_score(q, title, tags, stem, body_prefix)
                if score == 0:
                    continue

                rel = str(md_file.relative_to(jail.root)).replace("\\", "/")
                scored.append((score, {
                    "category": cat,
                    "title": title,
                    "tags": tags,
                    "path": rel,
                    "snippet": body[:500].strip(),
                    "source": meta.get("source", "manual"),
                }))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [item for _, item in scored[:max_results]]

    @staticmethod
    def _match_score(
        query: str,
        title: str,
        tags: list[str],
        stem: str,
        body_prefix: str,
    ) -> int:
        """Compute a relevance score (0 = no match)."""
        score = 0
        if query in title.lower():
            score += 100
        if any(query in t.lower() for t in tags):
            score += 50
        if query in stem.lower():
            score += 30
        if query in body_prefix.lower():
            score += 10
        return score
