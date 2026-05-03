# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for KnowledgeStore — CRUD, path validation, front matter, search.

Covers:
- list_all, read, write, delete for each category
- path depth constraints (rules=flat, experiences=1 sub-dir)
- .md extension enforcement
- ConfinedDir traversal rejection
- front matter parsing and graceful degradation
- search: title, tags, filename, body matching + ranking + limit
- search skips alwaysApply rules (they are injected via system prompt)
- tokenization: English stopwords, CJK/ASCII mixed splitting
- scoring: partial token match, source discount, table_names boost
"""

from __future__ import annotations

import pytest

from data_formulator.knowledge.store import (
    KnowledgeStore,
    parse_front_matter,
    VALID_CATEGORIES,
    _tokenize_query,
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

    def test_lists_experiences_in_subdirs(self, store, tmp_path):
        exp_dir = tmp_path / "knowledge" / "experiences" / "cleaning"
        exp_dir.mkdir(parents=True)
        (exp_dir / "missing.md").write_text(SAMPLE_MD_SKILL, encoding="utf-8")

        items = store.list_all("experiences")
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

    def test_writes_experiences_in_subdir(self, store, tmp_path):
        store.write("experiences", "cleaning/handle-missing.md", SAMPLE_MD_SKILL)
        assert (tmp_path / "knowledge" / "experiences" / "cleaning" / "handle-missing.md").exists()


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

    def test_experiences_one_subdir_ok(self):
        KnowledgeStore.validate_path("experiences", "cat/file.md")

    def test_experiences_two_subdirs_rejected(self):
        with pytest.raises(ValueError, match="one level"):
            KnowledgeStore.validate_path("experiences", "cat/sub/file.md")

    def test_skills_rejected_as_invalid(self):
        with pytest.raises(ValueError, match="Invalid category"):
            KnowledgeStore.validate_path("skills", "file.md")

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

        exp_dir = tmp_path / "knowledge" / "experiences" / "cleaning"
        exp_dir.mkdir(parents=True)
        (exp_dir / "missing.md").write_text(SAMPLE_MD_SKILL, encoding="utf-8")

    def test_search_by_title(self, store):
        results = store.search("Handle Missing")
        assert len(results) >= 1
        assert results[0]["title"] == "Handle Missing Values"

    def test_search_by_tags(self, store):
        results = store.search("pandas")
        assert len(results) >= 1
        assert results[0]["title"] == "Handle Missing Values"

    def test_search_by_filename(self, store):
        results = store.search("missing")
        assert len(results) >= 1

    def test_search_by_body(self, store):
        results = store.search("median")
        assert len(results) >= 1
        assert results[0]["title"] == "Handle Missing Values"

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
        results = store.search("ROI", categories=["experiences"])
        assert len(results) == 0

    def test_search_skips_always_apply_rules(self, store, tmp_path):
        """alwaysApply rules are injected via system prompt, not search."""
        results = store.search("ROI", categories=["rules"])
        assert len(results) == 0

    def test_search_returns_non_always_apply_rules(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "optional.md").write_text(
            "---\ntitle: Optional Rule\ntags: [test]\nalwaysApply: false\n---\nOptional content.\n",
            encoding="utf-8",
        )
        results = store.search("Optional", categories=["rules"])
        assert len(results) == 1
        assert results[0]["title"] == "Optional Rule"

    def test_title_match_ranks_higher(self, store):
        results = store.search("Handle Missing Values")
        assert len(results) >= 1
        assert results[0]["title"] == "Handle Missing Values"

    def test_search_case_insensitive(self, store):
        results = store.search("handle missing")
        assert len(results) >= 1
        assert results[0]["title"] == "Handle Missing Values"

    def test_partial_token_match_finds_results(self, store):
        """Long query with only partial overlap should still match."""
        results = store.search("show quarterly sales missing values trend")
        assert len(results) >= 1
        assert results[0]["title"] == "Handle Missing Values"

    def test_table_names_boost(self, store, tmp_path):
        """Entries tagged with a session table name get boosted."""
        exp_dir = tmp_path / "knowledge" / "experiences" / "analysis"
        exp_dir.mkdir(parents=True)
        (exp_dir / "sales-tip.md").write_text(
            "---\ntitle: Sales Analysis Tips\n"
            "tags: [sales_data, revenue]\nsource: manual\n---\n"
            "When analysing sales, check for seasonality.\n",
            encoding="utf-8",
        )
        results = store.search("analysis tips", table_names=["sales_data"])
        assert len(results) >= 1
        assert results[0]["title"] == "Sales Analysis Tips"

    def test_non_manual_source_discounted(self, store, tmp_path):
        """Non-manual entries score lower than equivalent manual entries."""
        exp_dir = tmp_path / "knowledge" / "experiences"
        (exp_dir / "auto-tip.md").write_text(
            "---\ntitle: Tip One\ntags: [tip]\nsource: distill\n---\nSome tip.\n",
            encoding="utf-8",
        )
        (exp_dir / "manual-tip.md").write_text(
            "---\ntitle: Tip One\ntags: [tip]\nsource: manual\n---\nSome tip.\n",
            encoding="utf-8",
        )
        results = store.search("Tip One", categories=["experiences"])
        assert len(results) == 2
        assert results[0]["source"] == "manual"
        assert results[1]["source"] == "distill"


# ── load_always_apply_rules ───────────────────────────────────────────────


class TestLoadAlwaysApplyRules:
    def test_loads_always_apply_rules(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "ask-me.md").write_text(
            "---\ntitle: Ask Me\nalwaysApply: true\n---\nAlways ask when uncertain.\n",
            encoding="utf-8",
        )
        rules = store.load_always_apply_rules()
        assert len(rules) == 1
        assert rules[0]["title"] == "Ask Me"
        assert "Always ask when uncertain" in rules[0]["body"]

    def test_skips_non_always_apply(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "opt.md").write_text(
            "---\ntitle: Optional\nalwaysApply: false\n---\nOptional body.\n",
            encoding="utf-8",
        )
        rules = store.load_always_apply_rules()
        assert len(rules) == 0

    def test_default_always_apply_is_true(self, store, tmp_path):
        """Rules without explicit alwaysApply default to true."""
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "default.md").write_text(SAMPLE_MD, encoding="utf-8")
        rules = store.load_always_apply_rules()
        assert len(rules) == 1
        assert rules[0]["title"] == "ROI Calculation"

    def test_empty_body_skipped(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "empty.md").write_text(
            "---\ntitle: Empty Rule\nalwaysApply: true\n---\n",
            encoding="utf-8",
        )
        rules = store.load_always_apply_rules()
        assert len(rules) == 0

    def test_graceful_on_empty_store(self, store):
        rules = store.load_always_apply_rules()
        assert rules == []


# ── format_rules_block ───────────────────────────────────────────────────


class TestFormatRulesBlock:
    def test_auto_load_and_format(self, store, tmp_path):
        rules_dir = tmp_path / "knowledge" / "rules"
        (rules_dir / "ask-me.md").write_text(
            "---\ntitle: Ask Me\nalwaysApply: true\n---\nAlways ask.\n",
            encoding="utf-8",
        )
        block = store.format_rules_block()
        assert "User Rules" in block
        assert "MANDATORY" in block
        assert "### Ask Me" in block
        assert "Always ask." in block

    def test_pre_loaded_rules(self, store):
        rules = [{"title": "Rule A", "body": "Do A."}, {"title": "Rule B", "body": "Do B."}]
        block = store.format_rules_block(rules)
        assert "### Rule A" in block
        assert "### Rule B" in block
        assert "Do A." in block
        assert "Do B." in block

    def test_empty_returns_empty_string(self, store):
        block = store.format_rules_block()
        assert block == ""

    def test_empty_list_returns_empty_string(self, store):
        block = store.format_rules_block([])
        assert block == ""

    def test_block_starts_with_newlines(self, store):
        rules = [{"title": "X", "body": "Y"}]
        block = store.format_rules_block(rules)
        assert block.startswith("\n\n")


# ── tokenization ─────────────────────────────────────────────────────────


class TestTokenizeQuery:
    def test_english_basic(self):
        tokens = _tokenize_query("quarterly sales trend")
        assert tokens == ["quarterly", "sales", "trend"]

    def test_english_stopwords_filtered(self):
        tokens = _tokenize_query("show the quarterly sales trend by region")
        assert "show" not in tokens
        assert "the" not in tokens
        assert "by" not in tokens
        assert "quarterly" in tokens
        assert "sales" in tokens
        assert "region" in tokens

    def test_short_ascii_filtered(self):
        tokens = _tokenize_query("a is an ROI ok")
        assert tokens == ["roi"]

    def test_pure_chinese_kept_as_single_token(self):
        tokens = _tokenize_query("盈利情况分析")
        assert tokens == ["盈利情况分析"]

    def test_mixed_cjk_ascii_split(self):
        tokens = _tokenize_query("帮我分析ROI")
        assert "roi" in tokens
        assert any("分析" in t for t in tokens)

    def test_mixed_cjk_ascii_with_spaces(self):
        tokens = _tokenize_query("分析 sales_data 的趋势")
        assert "sales_data" in tokens
        assert "分析" in tokens

    def test_underscore_preserved(self):
        tokens = _tokenize_query("sales_data regions")
        assert "sales_data" in tokens
        assert "regions" in tokens

    def test_empty_query(self):
        assert _tokenize_query("") == []
        assert _tokenize_query("   ") == []

    def test_all_stopwords_returns_empty(self):
        assert _tokenize_query("show the by") == []


# ── _match_score unit tests ──────────────────────────────────────────────


class TestMatchScore:
    def test_single_token_title_hit(self):
        score = KnowledgeStore._match_score(
            "ROI", "ROI Calculation", [], "roi", "",
        )
        assert score > 0

    def test_partial_tokens_accumulate(self):
        """2 out of 3 tokens matching title should still produce a score."""
        score = KnowledgeStore._match_score(
            "quarterly sales trend",
            "Sales Trend Analysis",
            [], "analysis", "",
        )
        assert score > 0

    def test_whole_string_bonus(self):
        full = KnowledgeStore._match_score(
            "ROI", "ROI Calculation", [], "roi", "",
        )
        no_title = KnowledgeStore._match_score(
            "ROI", "Something Else", [], "roi", "",
        )
        assert full > no_title

    def test_source_discount(self):
        manual = KnowledgeStore._match_score(
            "ROI", "ROI Guide", ["finance"], "roi", "",
            source="manual",
        )
        auto = KnowledgeStore._match_score(
            "ROI", "ROI Guide", ["finance"], "roi", "",
            source="distill",
        )
        assert auto == pytest.approx(manual * 0.9)

    def test_table_names_boost(self):
        without = KnowledgeStore._match_score(
            "analysis", "Analysis Tips", ["sales_data"], "tips", "",
        )
        with_tn = KnowledgeStore._match_score(
            "analysis", "Analysis Tips", ["sales_data"], "tips", "",
            table_names=["sales_data"],
        )
        assert with_tn > without

    def test_no_match_returns_zero(self):
        score = KnowledgeStore._match_score(
            "xyznonexistent", "ROI Calculation", ["finance"], "roi", "body text",
        )
        assert score == 0

    def test_cjk_mixed_query_matches(self):
        """Chinese+English query should match via extracted ASCII tokens."""
        score = KnowledgeStore._match_score(
            "帮我分析ROI", "ROI Calculation", ["finance"], "roi", "",
        )
        assert score > 0
