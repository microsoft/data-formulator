# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for KnowledgeStore — CRUD, path validation, front matter, search.

Covers:
- list_all, read, write, delete for each category
- path depth constraints (rules=flat, skills/experiences=1 sub-dir)
- .md extension enforcement
- ConfinedDir traversal rejection
- front matter parsing and graceful degradation
- search: title, tags, filename, body matching + ranking + limit
"""

from __future__ import annotations

import pytest

from data_formulator.knowledge.store import (
    KnowledgeStore,
    parse_front_matter,
    VALID_CATEGORIES,
)

pytestmark = [pytest.mark.backend]


SAMPLE_MD = """\
---
title: ROI Calculation
tags: [finance, computation]
created: 2026-04-26
updated: 2026-04-26
source: manual
---

ROI = (revenue - cost) / cost
"""

SAMPLE_MD_SKILL = """\
---
title: Handle Missing Values
tags: [data-cleaning, pandas]
created: 2026-04-26
updated: 2026-04-26
source: agent_summarized
source_session: sess-abc
---

When encountering missing values in a DataFrame, consider:
1. Drop rows if < 5% missing
2. Fill with median for numeric columns
"""


@pytest.fixture()
def store(tmp_path):
    return KnowledgeStore(tmp_path)


# ── CRUD: list_all ────────────────────────────────────────────────────────


class TestListAll:
    def test_lists_rules(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        items = store.list_all("rules")
        assert len(items) == 1
        assert items[0]["title"] == "ROI Calculation"
        assert items[0]["tags"] == ["finance", "computation"]
        assert items[0]["path"] == "roi.md"
        assert items[0]["source"] == "manual"

    def test_lists_skills_in_subdirs(self, store, tmp_path):
        skills_dir = tmp_path / "knowledge" / "skills" / "cleaning"
        skills_dir.mkdir(parents=True)
        (skills_dir / "missing.md").write_text(SAMPLE_MD_SKILL, encoding="utf-8")

        items = store.list_all("skills")
        assert len(items) == 1
        assert items[0]["path"] == "cleaning/missing.md"

    def test_empty_category_returns_empty(self, store):
        items = store.list_all("experiences")
        assert items == []

    def test_front_matter_title_fallback_to_stem(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "no-fm.md").write_text("Just content, no front matter.", encoding="utf-8")

        items = store.list_all("rules")
        assert items[0]["title"] == "no-fm"


# ── CRUD: read ────────────────────────────────────────────────────────────


class TestRead:
    def test_reads_content(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        content = store.read("rules", "roi.md")
        assert "ROI = (revenue - cost) / cost" in content

    def test_read_nonexistent_raises(self, store):
        with pytest.raises(FileNotFoundError):
            store.read("rules", "nope.md")


# ── CRUD: write ───────────────────────────────────────────────────────────


class TestWrite:
    def test_creates_new_file(self, store, tmp_path):
        store.write("rules", "new-rule.md", SAMPLE_MD)
        assert (tmp_path / "knowledge" / "rules" / "new-rule.md").exists()

    def test_updates_existing_file(self, store, tmp_path):
        store.write("rules", "upd.md", "original")
        store.write("rules", "upd.md", "updated content")
        content = store.read("rules", "upd.md")
        assert "updated content" in content

    def test_auto_adds_front_matter(self, store, tmp_path):
        store.write("rules", "bare.md", "No front matter here.")
        content = store.read("rules", "bare.md")
        assert content.startswith("---")
        assert "title: bare" in content

    def test_preserves_existing_front_matter(self, store):
        store.write("rules", "fm.md", SAMPLE_MD)
        content = store.read("rules", "fm.md")
        assert "title: ROI Calculation" in content

    def test_writes_skill_in_subdir(self, store, tmp_path):
        store.write("skills", "cleaning/handle-missing.md", SAMPLE_MD_SKILL)
        assert (tmp_path / "knowledge" / "skills" / "cleaning" / "handle-missing.md").exists()


# ── CRUD: delete ──────────────────────────────────────────────────────────


class TestDelete:
    def test_deletes_file(self, store, tmp_path):
        store.write("rules", "to-delete.md", SAMPLE_MD)
        store.delete("rules", "to-delete.md")
        assert not (tmp_path / "knowledge" / "rules" / "to-delete.md").exists()

    def test_delete_nonexistent_raises(self, store):
        with pytest.raises(FileNotFoundError):
            store.delete("rules", "ghost.md")


# ── path validation ───────────────────────────────────────────────────────


class TestValidatePath:
    def test_rules_flat_file_ok(self):
        KnowledgeStore.validate_path("rules", "my-rule.md")

    def test_rules_subdir_rejected(self):
        with pytest.raises(ValueError, match="sub-directories"):
            KnowledgeStore.validate_path("rules", "sub/file.md")

    def test_skills_one_subdir_ok(self):
        KnowledgeStore.validate_path("skills", "cat/file.md")

    def test_skills_two_subdirs_rejected(self):
        with pytest.raises(ValueError, match="one level"):
            KnowledgeStore.validate_path("skills", "cat/sub/file.md")

    def test_experiences_one_subdir_ok(self):
        KnowledgeStore.validate_path("experiences", "cat/file.md")

    def test_experiences_two_subdirs_rejected(self):
        with pytest.raises(ValueError, match="one level"):
            KnowledgeStore.validate_path("experiences", "cat/sub/file.md")

    def test_non_md_extension_rejected(self):
        with pytest.raises(ValueError, match=".md"):
            KnowledgeStore.validate_path("rules", "file.txt")

    def test_invalid_category_rejected(self):
        with pytest.raises(ValueError, match="Invalid category"):
            KnowledgeStore.validate_path("invalid", "file.md")

    def test_empty_path_rejected(self):
        with pytest.raises(ValueError, match="Empty"):
            KnowledgeStore.validate_path("rules", "")

    def test_traversal_blocked_by_confined_dir(self, store):
        with pytest.raises(ValueError):
            store.read("rules", "../../../etc/passwd.md")


# ── front matter parsing ─────────────────────────────────────────────────


class TestFrontMatter:
    def test_valid_front_matter(self):
        meta, body = parse_front_matter(SAMPLE_MD)
        assert meta["title"] == "ROI Calculation"
        assert meta["tags"] == ["finance", "computation"]
        assert "ROI = (revenue - cost) / cost" in body

    def test_no_front_matter_degrades(self):
        meta, body = parse_front_matter("Just plain text.")
        assert meta == {}
        assert body == "Just plain text."

    def test_invalid_yaml_degrades(self):
        bad = "---\n: invalid: yaml: [\n---\nContent."
        meta, body = parse_front_matter(bad)
        assert meta == {}
        assert body == bad


# ── search ────────────────────────────────────────────────────────────────


class TestSearch:
    @pytest.fixture(autouse=True)
    def _setup_knowledge(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "roi.md").write_text(SAMPLE_MD, encoding="utf-8")

        skills_dir = tmp_path / "knowledge" / "skills" / "cleaning"
        skills_dir.mkdir(parents=True)
        (skills_dir / "missing.md").write_text(SAMPLE_MD_SKILL, encoding="utf-8")

    def test_search_by_title(self, store):
        results = store.search("ROI")
        assert len(results) >= 1
        assert results[0]["title"] == "ROI Calculation"

    def test_search_by_tags(self, store):
        results = store.search("pandas")
        assert len(results) >= 1
        assert results[0]["title"] == "Handle Missing Values"

    def test_search_by_filename(self, store):
        results = store.search("missing")
        assert len(results) >= 1

    def test_search_by_body(self, store):
        results = store.search("revenue")
        assert len(results) >= 1
        assert results[0]["title"] == "ROI Calculation"

    def test_empty_query_returns_empty(self, store):
        assert store.search("") == []
        assert store.search("   ") == []

    def test_no_match_returns_empty(self, store):
        assert store.search("xyznonexistent") == []

    def test_max_results_limit(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        for i in range(15):
            (rules_dir / f"test-rule-{i}.md").write_text(
                f"---\ntitle: Test {i}\ntags: [common]\ncreated: 2026-04-26\nupdated: 2026-04-26\n---\nBody about common topic.\n",
                encoding="utf-8",
            )
        results = store.search("common", max_results=5)
        assert len(results) <= 5

    def test_search_filters_by_category(self, store):
        results = store.search("ROI", categories=["skills"])
        assert len(results) == 0

    def test_title_match_ranks_higher(self, store):
        results = store.search("ROI")
        if len(results) > 1:
            assert results[0]["title"] == "ROI Calculation"

    def test_search_case_insensitive(self, store):
        results = store.search("roi")
        assert len(results) >= 1
        assert results[0]["title"] == "ROI Calculation"
