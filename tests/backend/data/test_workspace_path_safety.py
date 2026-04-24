# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Security tests for Workspace path traversal checks (FINDING-4)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from data_formulator.datalake.workspace import Workspace

pytestmark = [pytest.mark.backend]


class TestWorkspacePathTraversal:

    def test_normal_identity_succeeds(self, tmp_path):
        ws = Workspace("alice", root_dir=tmp_path)
        assert ws._path.exists()
        shutil.rmtree(tmp_path, ignore_errors=True)

    def test_dotdot_identity_sanitized_safely(self, tmp_path):
        """'../admin' is sanitized to 'admin' by secure_filename — no traversal."""
        ws = Workspace("../admin", root_dir=tmp_path)
        assert ws._path.resolve().is_relative_to(tmp_path.resolve())
        assert ".." not in ws._path.parts
        shutil.rmtree(tmp_path, ignore_errors=True)

    def test_slash_identity_sanitized_safely(self, tmp_path):
        """'alice/../../root' is sanitized to 'alice_.._.._root' — no traversal."""
        ws = Workspace("alice/../../root", root_dir=tmp_path)
        assert ws._path.resolve().is_relative_to(tmp_path.resolve())
        assert ".." not in ws._path.parts
        shutil.rmtree(tmp_path, ignore_errors=True)

    def test_empty_identity_rejected(self, tmp_path):
        with pytest.raises(ValueError):
            Workspace("", root_dir=tmp_path)

    def test_path_must_be_under_root(self, tmp_path):
        """The workspace path must be strictly under root (not equal to root)."""
        root = tmp_path / "workspaces"
        root.mkdir()
        with pytest.raises(ValueError):
            Workspace(".", root_dir=root)
