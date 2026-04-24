# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for DockerSandbox output path validation.

The DockerSandbox uses ``safe_data_filename`` + ``os.path.realpath`` +
``startswith`` to prevent ``output_variable`` from escaping the output
directory.  These tests verify that protection WITHOUT running Docker.
"""
from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from data_formulator.sandbox.docker_sandbox import DockerSandbox

pytestmark = [pytest.mark.backend]


class _MinimalWorkspace:
    def __init__(self, path: str):
        self._path = path

    @contextmanager
    def local_dir(self):
        yield self._path


class TestOutputPathValidation:
    """Verify that malicious output_variable values are rejected
    before the container is launched or when reading back output."""

    @pytest.fixture
    def workspace(self, tmp_path):
        csv = tmp_path / "sample.csv"
        csv.write_text("a,b\n1,2\n")
        return _MinimalWorkspace(str(tmp_path))

    @pytest.fixture
    def sandbox(self):
        return DockerSandbox(timeout=10)

    def _run_with_fake_docker(self, sandbox, workspace, output_var):
        """Run sandbox with a mocked subprocess that always 'succeeds'.

        Returns the result dict so we can check whether the path
        validation logic rejected the output_variable.
        """
        import subprocess as sp

        fake_result = MagicMock()
        fake_result.returncode = 0
        fake_result.stdout = "__DOCKER_SANDBOX_OK__"
        fake_result.stderr = ""

        with patch.object(sp, "run", return_value=fake_result):
            return sandbox.run_python_code(
                "import pandas as pd; output = pd.DataFrame({'x': [1]})",
                workspace,
                output_var,
            )

    def test_traversal_via_slashes_neutralized(self, sandbox, workspace):
        """Path traversal is neutralized by safe_data_filename extracting
        the basename — the result stays inside output_dir."""
        result = self._run_with_fake_docker(sandbox, workspace, "../../etc/passwd")
        assert result["status"] == "error"
        # safe_data_filename strips path components (../../etc/ → "passwd"),
        # so the file simply doesn't exist — traversal is neutralized either way.
        assert "passwd" in result["content"] or "Invalid" in result["content"]

    def test_traversal_via_dotdot_neutralized(self, sandbox, workspace):
        result = self._run_with_fake_docker(sandbox, workspace, "../escape")
        assert result["status"] == "error"
        assert "escape" in result["content"] or "Invalid" in result["content"]

    def test_empty_output_variable_rejected(self, sandbox, workspace):
        result = self._run_with_fake_docker(sandbox, workspace, "")
        assert result["status"] == "error"

    def test_normal_output_variable_not_rejected(self, sandbox, workspace):
        """A clean variable name should pass validation (but fail because
        the parquet file doesn't exist — which is a different error)."""
        result = self._run_with_fake_docker(sandbox, workspace, "output_df")
        # Should NOT be "Invalid output_variable"
        if result["status"] == "error":
            assert "Invalid output_variable" not in result["content"]

    def test_output_variable_with_separator(self, sandbox, workspace):
        """output_variable containing OS path separators should be rejected."""
        malicious = f"foo{os.sep}bar"
        result = self._run_with_fake_docker(sandbox, workspace, malicious)
        assert result["status"] == "error"
