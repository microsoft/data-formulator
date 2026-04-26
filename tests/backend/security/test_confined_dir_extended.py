# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for extended ConfinedDir API (read_text, write_text, exists, iterdir, rglob, unlink).

These methods are needed by ReasoningLogger and KnowledgeStore.  All path
operations must go through ``resolve()`` so path-traversal prevention is
inherited automatically.
"""

from __future__ import annotations

import pytest

from data_formulator.security.path_safety import ConfinedDir

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def jail(tmp_path):
    return ConfinedDir(tmp_path, mkdir=True)


# ── read_text ─────────────────────────────────────────────────────────────


class TestReadText:
    def test_reads_existing_file(self, jail, tmp_path):
        (tmp_path / "hello.txt").write_text("world", encoding="utf-8")
        assert jail.read_text("hello.txt") == "world"

    def test_reads_utf8_by_default(self, jail, tmp_path):
        (tmp_path / "uni.txt").write_text("你好", encoding="utf-8")
        assert jail.read_text("uni.txt") == "你好"

    def test_traversal_raises(self, jail):
        with pytest.raises(ValueError, match="traversal|escape|absolute|\\.\\.|Empty"):
            jail.read_text("../etc/passwd")

    def test_nonexistent_file_raises(self, jail):
        with pytest.raises(FileNotFoundError):
            jail.read_text("nope.txt")


# ── write_text ────────────────────────────────────────────────────────────


class TestWriteText:
    def test_creates_new_file(self, jail, tmp_path):
        jail.write_text("out.txt", "content")
        assert (tmp_path / "out.txt").read_text(encoding="utf-8") == "content"

    def test_creates_parent_dirs(self, jail, tmp_path):
        jail.write_text("sub/dir/file.md", "nested")
        assert (tmp_path / "sub" / "dir" / "file.md").read_text(encoding="utf-8") == "nested"

    def test_returns_resolved_path(self, jail, tmp_path):
        result = jail.write_text("ret.txt", "ok")
        assert result == (tmp_path / "ret.txt").resolve()

    def test_traversal_raises(self, jail):
        with pytest.raises(ValueError):
            jail.write_text("../../evil.txt", "pwned")


# ── exists ────────────────────────────────────────────────────────────────


class TestExists:
    def test_existing_file_returns_true(self, jail, tmp_path):
        (tmp_path / "a.txt").write_text("hi")
        assert jail.exists("a.txt") is True

    def test_missing_file_returns_false(self, jail):
        assert jail.exists("missing.txt") is False

    def test_traversal_returns_false(self, jail):
        assert jail.exists("../../../etc/passwd") is False

    def test_directory_returns_true(self, jail, tmp_path):
        (tmp_path / "subdir").mkdir()
        assert jail.exists("subdir") is True


# ── iterdir ───────────────────────────────────────────────────────────────


class TestIterdir:
    def test_lists_root_contents(self, jail, tmp_path):
        (tmp_path / "a.txt").touch()
        (tmp_path / "b.txt").touch()
        names = sorted(p.name for p in jail.iterdir())
        assert names == ["a.txt", "b.txt"]

    def test_lists_subdirectory(self, jail, tmp_path):
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "c.txt").touch()
        names = [p.name for p in jail.iterdir("sub")]
        assert names == ["c.txt"]

    def test_empty_directory_returns_empty(self, jail):
        assert list(jail.iterdir()) == []

    def test_traversal_raises(self, jail):
        with pytest.raises(ValueError):
            list(jail.iterdir("../../"))


# ── rglob ─────────────────────────────────────────────────────────────────


class TestRglob:
    def test_finds_matching_files(self, jail, tmp_path):
        (tmp_path / "a.md").touch()
        sub = tmp_path / "deep" / "nested"
        sub.mkdir(parents=True)
        (sub / "b.md").touch()
        (sub / "c.txt").touch()
        results = sorted(p.name for p in jail.rglob("*.md"))
        assert results == ["a.md", "b.md"]

    def test_no_match_returns_empty(self, jail, tmp_path):
        (tmp_path / "file.txt").touch()
        assert list(jail.rglob("*.md")) == []

    def test_rglob_in_subdirectory(self, jail, tmp_path):
        sub = tmp_path / "only_here"
        sub.mkdir()
        (sub / "x.md").touch()
        (tmp_path / "root.md").touch()
        results = [p.name for p in jail.rglob("*.md", "only_here")]
        assert results == ["x.md"]


# ── unlink ────────────────────────────────────────────────────────────────


class TestUnlink:
    def test_deletes_existing_file(self, jail, tmp_path):
        f = tmp_path / "doomed.txt"
        f.write_text("bye")
        jail.unlink("doomed.txt")
        assert not f.exists()

    def test_traversal_raises(self, jail):
        with pytest.raises(ValueError):
            jail.unlink("../outside.txt")

    def test_nonexistent_raises(self, jail):
        with pytest.raises(FileNotFoundError):
            jail.unlink("ghost.txt")


# ── regression: existing resolve / write / __truediv__ ────────────────────


class TestExistingApiRegression:
    def test_resolve_normal(self, jail, tmp_path):
        (tmp_path / "data").mkdir()
        p = jail.resolve("data")
        assert p == (tmp_path / "data").resolve()

    def test_resolve_traversal_raises(self, jail):
        with pytest.raises(ValueError):
            jail.resolve("../bad")

    def test_write_bytes(self, jail, tmp_path):
        jail.write("bin.dat", b"\x00\x01\x02")
        assert (tmp_path / "bin.dat").read_bytes() == b"\x00\x01\x02"

    def test_truediv_operator(self, jail, tmp_path):
        (tmp_path / "x.txt").touch()
        assert (jail / "x.txt") == (tmp_path / "x.txt").resolve()
