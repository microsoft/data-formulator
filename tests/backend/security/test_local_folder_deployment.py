# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""Tests for FINDING-3: local_folder connector must be disabled in multi-user mode."""

from __future__ import annotations

import importlib
import os
from unittest.mock import patch

import pytest

pytestmark = [pytest.mark.backend]


def _reload_registry(workspace_backend: str):
    """Reload data_loader with a specific WORKSPACE_BACKEND value."""
    import data_formulator.data_loader as dl_module
    with patch.dict(os.environ, {"WORKSPACE_BACKEND": workspace_backend}):
        importlib.reload(dl_module)
    return dl_module.DATA_LOADERS, dl_module.DISABLED_LOADERS


class TestLocalFolderDeploymentRestriction:

    def test_local_mode_keeps_local_folder(self):
        loaders, disabled = _reload_registry("local")
        assert "local_folder" in loaders
        assert "local_folder" not in disabled

    def test_multi_user_mode_disables_local_folder(self):
        loaders, disabled = _reload_registry("azure_blob")
        try:
            assert "local_folder" not in loaders
            assert "local_folder" in disabled
        finally:
            _reload_registry("local")

    def test_ephemeral_mode_disables_local_folder(self):
        loaders, disabled = _reload_registry("ephemeral")
        try:
            assert "local_folder" not in loaders
            assert "local_folder" in disabled
        finally:
            _reload_registry("local")

    def test_create_connector_rejects_disabled_type(self):
        """When local_folder is disabled, create_connector returns 400."""
        loaders, disabled = _reload_registry("azure_blob")
        try:
            from flask import Flask
            from data_formulator.data_connector import connectors_bp
            app = Flask(__name__)
            app.config["TESTING"] = True
            app.register_blueprint(connectors_bp)

            with patch("data_formulator.auth.identity.get_identity_id", return_value="test-user"):
                with app.test_client() as c:
                    resp = c.post("/api/connectors", json={
                        "loader_type": "local_folder",
                        "display_name": "Evil local",
                        "params": {"root_dir": "/etc"},
                    })
                    assert resp.status_code == 200
                    assert "Unknown" in resp.get_json().get("message", "")
        finally:
            _reload_registry("local")
