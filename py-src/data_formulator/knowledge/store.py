# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Knowledge store — manages user knowledge files (rules, experiences).

Each user has a ``knowledge/`` directory under their home with two
sub-directories: ``rules`` and ``experiences``.  Every knowledge entry is a
Markdown file with YAML front matter.

All file I/O is routed through :class:`ConfinedDir` for path safety.

Directory depth constraints:

- ``rules``: flat — only files directly under ``rules/`` (1 path part)
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

VALID_CATEGORIES = frozenset({"rules", "experiences"})

_MAX_DEPTH = {
    "rules": 1,     # flat: only "file.md"
    "experiences": 2,   # one sub-dir: "topic/file.md"
}

KNOWLEDGE_LIMITS: dict[str, int] = {
    "rule_description_max": 100,
    "rules": 350,
    "experiences": 2000,
}

# ---------------------------------------------------------------------------
# Tokenization helpers for improved search scoring
# ---------------------------------------------------------------------------

_ENGLISH_STOPWORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "shall",
    "should", "may", "might", "must", "can", "could",
    "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
    "she", "her", "it", "its", "they", "them", "their",
    "what", "which", "who", "whom", "this", "that", "these", "those",
    "am", "if", "or", "but", "not", "no", "nor", "so", "too", "very",
    "and", "as", "at", "by", "for", "from", "in", "into", "of", "on",
    "to", "up", "with", "about", "after", "before", "between", "down",
    "during", "each", "few", "more", "most", "other", "some", "such",
    "than", "then", "how", "when", "where", "why", "all", "any", "both",
    "every", "here", "there", "just", "only", "also", "over", "own",
    "same", "out",
    "show", "find", "get", "use", "make", "help", "let", "want", "need",
    "please", "like", "using", "used",
})

_MIN_TOKEN_LEN = 2

_CJK_ASCII_RE = re.compile(
    r"([\u2e80-\u9fff\uf900-\ufaff\U00020000-\U0002fa1f]+|[a-z0-9_]+)",
)


def _tokenize_query(query: str) -> list[str]:
    """Split *query* into meaningful keyword tokens.

    1. Space-split the query.
    2. For tokens containing **both** CJK and ASCII characters, further
       split into CJK segments and ASCII segments so each can match
       independently.  E.g. ``"帮我分析ROI"`` → ``["帮我分析", "roi"]``.
    3. Filter English stopwords and short ASCII tokens (≤ 2 chars).
    4. Non-ASCII tokens (e.g. Chinese phrases) are kept regardless of
       length — they participate in whole-substring matching.

    When proper Chinese word segmentation is needed in the future,
    only this function needs to change (e.g. integrate *jieba*).
    """
    raw = query.lower().split()
    tokens: list[str] = []
    for t in raw:
        if t in _ENGLISH_STOPWORDS:
            continue

        has_cjk = not t.isascii()
        has_ascii = any(c.isascii() and c.isalnum() for c in t)

        if has_cjk and has_ascii:
            for seg in _CJK_ASCII_RE.findall(t):
                if seg in _ENGLISH_STOPWORDS:
                    continue
                if seg.isascii() and len(seg) <= _MIN_TOKEN_LEN:
                    continue
                tokens.append(seg)
        else:
            if t.isascii() and len(t) <= _MIN_TOKEN_LEN:
                continue
            tokens.append(t)
    return tokens


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


# ---------------------------------------------------------------------------
# Type-safe front matter model
# ---------------------------------------------------------------------------

class KnowledgeItemMeta:
    """Type-safe representation of a knowledge file's front matter.

    Guarantees all fields are the expected types regardless of what YAML
    produced.  Construct via ``from_raw(meta_dict, fallback_stem)``.
    """

    __slots__ = ("title", "tags", "source", "created", "description", "always_apply")

    def __init__(
        self,
        title: str,
        tags: list[str],
        source: str,
        created: str,
        description: str,
        always_apply: bool,
    ):
        self.title = title
        self.tags = tags
        self.source = source
        self.created = created
        self.description = description
        self.always_apply = always_apply

    @classmethod
    def from_raw(cls, meta: dict[str, Any], fallback_stem: str = "") -> "KnowledgeItemMeta":
        """Build from a raw YAML-parsed dict with type coercion."""
        title = meta.get("title", fallback_stem)
        title = str(title) if title is not None else fallback_stem

        raw_tags = meta.get("tags", [])
        if isinstance(raw_tags, list):
            tags = [str(t) for t in raw_tags]
        elif raw_tags is None:
            tags = []
        else:
            tags = [str(raw_tags)]

        source = str(meta.get("source", "manual") or "manual")
        created = str(meta.get("created", "") or "")
        description = str(meta.get("description", "") or "")
        always_apply = bool(meta.get("alwaysApply", True))

        return cls(
            title=title,
            tags=tags,
            source=source,
            created=created,
            description=description,
            always_apply=always_apply,
        )


def _ensure_front_matter(content: str, path: str, category: str = "") -> str:
    """If *content* lacks front matter, prepend a minimal header."""
    meta, _ = parse_front_matter(content)
    if meta:
        return content

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    stem = Path(path).stem
    lines = [
        "---",
        f"title: {stem}",
    ]
    if category == "rules":
        lines.append("description: \"\"")
        lines.append("alwaysApply: true")
    lines += [
        f"created: {today}",
        f"updated: {today}",
        "source: manual",
        "---",
        "",
        "",
    ]
    return "\n".join(lines) + content


# ---------------------------------------------------------------------------
# KnowledgeStore
# ---------------------------------------------------------------------------


class KnowledgeStore:
    """Manages the user's knowledge directory tree.

    Usage::

        store = KnowledgeStore(user_home)
        items = store.list_all("rules")
        content = store.read("experiences", "data-cleaning/handle-missing.md")
        store.write("rules", "date-format.md", md_content)
        store.delete("rules", "date-format.md")
        results = store.search("ROI", categories=["rules", "experiences"])
    """

    def __init__(self, user_home: Path | str) -> None:
        user_home = Path(user_home)
        self._root = ConfinedDir(user_home / "knowledge", mkdir=True)
        self._jails: dict[str, ConfinedDir] = {
            "rules": ConfinedDir(self._root.root / "rules", mkdir=True),
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
        For rules, also includes ``description`` and ``alwaysApply``.
        """
        jail = self._jail(category)
        items: list[dict[str, Any]] = []

        for md_file in sorted(jail.rglob("*.md")):
            try:
                raw = md_file.read_text(encoding="utf-8")
            except Exception:
                logger.warning("Failed to read knowledge file %s", md_file.name)
                continue

            raw_meta, _ = parse_front_matter(raw)
            km = KnowledgeItemMeta.from_raw(raw_meta, md_file.stem)
            rel = str(md_file.relative_to(jail.root)).replace("\\", "/")
            item: dict[str, Any] = {
                "title": km.title,
                "tags": km.tags,
                "path": rel,
                "source": km.source,
                "created": km.created,
            }
            if category == "rules":
                item["description"] = km.description
                item["alwaysApply"] = km.always_apply
            items.append(item)

        return items

    def read(self, category: str, path: str) -> str:
        """Read the full content of a knowledge file."""
        self.validate_path(category, path)
        return self._jail(category).read_text(path)

    def write(self, category: str, path: str, content: str) -> Path:
        """Create or update a knowledge file.

        If *content* lacks YAML front matter, a minimal header is prepended.
        Validates body length and (for rules) description length against
        :data:`KNOWLEDGE_LIMITS`.
        """
        self.validate_path(category, path)
        content = _ensure_front_matter(content, path, category)

        meta, body = parse_front_matter(content)

        if category == "rules":
            desc = meta.get("description", "")
            desc_limit = KNOWLEDGE_LIMITS["rule_description_max"]
            if isinstance(desc, str) and len(desc) > desc_limit:
                raise ValueError(
                    f"Rule description exceeds {desc_limit} characters "
                    f"(got {len(desc)})"
                )

        body_limit = KNOWLEDGE_LIMITS.get(category)
        if body_limit is not None:
            body_len = len(body.strip())
            if body_len > body_limit:
                raise ValueError(
                    f"{category} body exceeds {body_limit} characters "
                    f"(got {body_len})"
                )

        return self._jail(category).write_text(path, content)

    def delete(self, category: str, path: str) -> None:
        """Delete a knowledge file."""
        self.validate_path(category, path)
        self._jail(category).unlink(path)

    # -- alwaysApply rules helper ------------------------------------------

    def load_always_apply_rules(self) -> list[dict[str, str]]:
        """Load rules with ``alwaysApply=true`` for system prompt injection.

        Returns a list of ``{"title": ..., "body": ...}`` dicts.
        Non-alwaysApply rules are excluded (they are picked up via search).
        Returns empty list on failure (graceful degradation).
        """
        try:
            items = self.list_all("rules")
            result: list[dict[str, str]] = []
            for item in items:
                if not item.get("alwaysApply", True):
                    continue
                try:
                    content = self.read("rules", item["path"])
                    _, body = parse_front_matter(content)
                    if body.strip():
                        result.append({"title": item["title"], "body": body.strip()})
                except Exception:
                    continue
            return result
        except Exception:
            logger.warning("Failed to load alwaysApply rules", exc_info=True)
            return []

    def format_rules_block(
        self, rules: list[dict[str, str]] | None = None
    ) -> str:
        """Return a formatted prompt block for ``alwaysApply`` rules.

        Args:
            rules: Pre-loaded rules from :meth:`load_always_apply_rules`.
                   When *None* (default), calls ``load_always_apply_rules()``
                   automatically.  Pass an already-loaded list to avoid a
                   second file-system scan when the caller also needs the
                   raw data (e.g. for ``_injected_rules`` tracking).

        Returns a ready-to-append string (including leading newlines) or
        an empty string when there are no rules.  Handles all exceptions
        internally so callers need no try/except.

        Usage in any Agent::

            # Simple — one-liner, loads + formats internally
            prompt += store.format_rules_block()

            # With pre-loaded data (when you also need the list)
            rules = store.load_always_apply_rules()
            titles = [r["title"] for r in rules]
            prompt += store.format_rules_block(rules)
        """
        try:
            if rules is None:
                rules = self.load_always_apply_rules()
            if not rules:
                return ""
            block = (
                "\n\n## ⚠ User Rules (MANDATORY — override defaults)\n\n"
                "The following rules are set by the user and MUST be followed.\n"
                "When a user rule conflicts with other guidelines, "
                "the user rule takes priority.\n"
            )
            for rule in rules:
                block += f"\n### {rule['title']}\n{rule['body']}\n"
            return block
        except Exception:
            logger.warning("Failed to format rules block", exc_info=True)
            return ""

    # -- search ------------------------------------------------------------

    def search(
        self,
        query: str,
        categories: list[str] | None = None,
        max_results: int = 10,
        table_names: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Search across knowledge categories.

        Tokenizes *query* into keywords and scores each entry using
        multi-field weighted matching (title > tags > filename > body).
        Whole-string exact matches and table-name / tag overlaps receive
        additional bonuses.  Non-manual sources are slightly discounted.

        *table_names* (optional) are table names from the current session;
        when a table name appears in an entry's tags the entry is boosted.
        """
        if not query or not query.strip():
            return []

        q = query.strip()
        cats = categories or list(VALID_CATEGORIES)
        scored: list[tuple[float, dict[str, Any]]] = []

        for cat in cats:
            if cat not in self._jails:
                continue
            jail = self._jails[cat]
            for md_file in jail.rglob("*.md"):
                try:
                    raw = md_file.read_text(encoding="utf-8")
                except Exception:
                    continue

                raw_meta, body = parse_front_matter(raw)
                km = KnowledgeItemMeta.from_raw(raw_meta, md_file.stem)

                if cat == "rules" and km.always_apply:
                    continue

                score = self._match_score(
                    q, km.title, km.tags, md_file.stem, body[:200],
                    source=km.source, table_names=table_names,
                )
                if score <= 0:
                    continue

                rel = str(md_file.relative_to(jail.root)).replace("\\", "/")
                scored.append((score, {
                    "category": cat,
                    "title": km.title,
                    "tags": km.tags,
                    "path": rel,
                    "snippet": body[:500].strip(),
                    "source": km.source,
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
        *,
        source: str = "manual",
        table_names: list[str] | None = None,
    ) -> float:
        """Compute a relevance score (0 = no match).

        Tokenizes *query*, then scores each token against multiple fields
        with weights normalised by token count.  Whole-string and
        table-name bonuses are added on top.  Non-manual sources receive
        a 0.9× discount.
        """
        tokens = _tokenize_query(query)
        q = query.strip().lower()
        n = len(tokens)
        score: float = 0.0

        # Per-token multi-field weighted scoring
        if n > 0:
            title_l = title.lower()
            stem_l = stem.lower()
            body_l = body_prefix.lower()
            tags_l = [t.lower() for t in tags]

            for token in tokens:
                if token in title_l:
                    score += 100 / n
                if any(token in tl for tl in tags_l):
                    score += 50 / n
                if token in stem_l:
                    score += 30 / n
                if token in body_l:
                    score += 10 / n

        # Whole-string bonus (handles short queries like "ROI")
        if q and q in title.lower():
            score += 50
        if q and any(q in t.lower() for t in tags):
            score += 50

        # Table-name → tag overlap bonus
        if table_names:
            tags_l_set = {t.lower() for t in tags}
            for tn in table_names:
                if any(tn.lower() in tl for tl in tags_l_set):
                    score += 30

        # Non-manual source slight discount
        if score > 0 and source != "manual":
            score *= 0.9

        return score
