# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""End-to-end integration tests for MySQL via DataConnector routes.

Tests the full lifecycle: connect → browse hierarchy → scope pinning →
import → preview → refresh → disconnect.

Requires MySQL running (e.g. ./tests/run_test_dbs.sh start mysql).
Environment: MYSQL_HOST, MYSQL_PORT (default 3307), MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest.mock import patch

import flask
import pytest

pytestmark = [pytest.mark.backend, pytest.mark.plugin]


def get_mysql_config() -> Dict[str, Any]:
    return {
        "host": os.getenv("MYSQL_HOST", "localhost"),
        "port": os.getenv("MYSQL_PORT", "3307"),
        "user": os.getenv("MYSQL_USER", "root"),
        "password": os.getenv("MYSQL_PASSWORD", "rootpassword"),
        "database": os.getenv("MYSQL_DATABASE", "testdb"),
    }


def mysql_available() -> bool:
    import socket
    cfg = get_mysql_config()
    host = cfg.get("host", "localhost")
    port = int(cfg.get("port", "3307"))
    if host in ("localhost", "127.0.0.1"):
        host = "127.0.0.1"
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(2)
    try:
        sock.connect((host, port))
        sock.close()
        return True
    except (socket.error, OSError):
        return False


def _make_app_and_client(source_id="mysql", default_params=None):
    from data_formulator.data_connector import DataConnector
    from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader

    app = flask.Flask(__name__)
    app.config["TESTING"] = True
    app.secret_key = "test-secret"

    source = DataConnector.from_loader(
        MySQLDataLoader,
        source_id=source_id,
        display_name="Test MySQL",
        default_params=default_params or {},
    )
    app.register_blueprint(source.create_blueprint())
    return app, app.test_client(), source


@unittest.skipUnless(
    mysql_available(),
    "MySQL not available (start with ./tests/run_test_dbs.sh start mysql).",
)
class TestMySQLConnectedSourceE2E(unittest.TestCase):
    """End-to-end tests: DataConnector routes → real MySQL."""

    def setUp(self):
        self._workspace_root = None
        self._identity = "test-user-mysql-e2e"

    def tearDown(self):
        if self._workspace_root and Path(self._workspace_root).exists():
            shutil.rmtree(self._workspace_root, ignore_errors=True)

    def _workspace_root_path(self):
        if self._workspace_root is None:
            self._workspace_root = tempfile.mkdtemp(prefix="df_test_mysql_e2e_")
        return self._workspace_root

    # ==============================================================
    # Auth lifecycle
    # ==============================================================

    def test_connect_success(self):
        app, client, source = _make_app_and_client()
        cfg = get_mysql_config()
        with patch.object(type(source), "_get_identity", return_value=self._identity):
            resp = client.post("/api/connectors/mysql/auth/connect", json={"params": cfg})
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data["status"], "connected")
            # MySQL hierarchy: database → table
            keys = [h["key"] for h in data["hierarchy"]]
            self.assertEqual(keys, ["database", "table"])

    def test_disconnect_and_status(self):
        app, client, source = _make_app_and_client()
        cfg = get_mysql_config()
        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/mysql/auth/connect", json={"params": cfg})
            resp = client.post("/api/connectors/mysql/auth/disconnect")
            self.assertEqual(resp.get_json()["status"], "disconnected")

            resp = client.get("/api/connectors/mysql/auth/status")
            self.assertFalse(resp.get_json()["connected"])

    # ==============================================================
    # Catalog browsing — database pinned (default test config)
    # ==============================================================

    def test_browse_with_database_pinned(self):
        """With database param set, ls([]) should show tables directly."""
        cfg = get_mysql_config()
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            resp = client.post("/api/connectors/mysql/auth/connect", json={"params": cfg})
            data = resp.get_json()
            # database is pinned → effective_hierarchy only has "table"
            eff_keys = [h["key"] for h in data["effective_hierarchy"]]
            self.assertNotIn("database", eff_keys)
            self.assertIn("table", eff_keys)

            # ls([]) should return tables directly
            resp = client.post("/api/connectors/mysql/catalog/ls", json={"path": []})
            nodes = resp.get_json()["nodes"]
            self.assertTrue(len(nodes) > 0)
            table_names = [n["name"] for n in nodes]
            self.assertIn("products", table_names)
            for n in nodes:
                self.assertEqual(n["node_type"], "table")

    def test_browse_without_database_pinned(self):
        """Without database param, ls([]) should list databases first."""
        cfg = get_mysql_config()
        unpinned_cfg = {k: v for k, v in cfg.items() if k != "database"}
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            resp = client.post("/api/connectors/mysql/auth/connect", json={
                "params": unpinned_cfg,
            })
            data = resp.get_json()
            # Should not be pinned
            eff_keys = [h["key"] for h in data["effective_hierarchy"]]
            self.assertIn("database", eff_keys)

            # ls([]) → databases
            resp = client.post("/api/connectors/mysql/catalog/ls", json={"path": []})
            nodes = resp.get_json()["nodes"]
            db_names = [n["name"] for n in nodes]
            self.assertIn("testdb", db_names)
            for n in nodes:
                self.assertEqual(n["node_type"], "namespace")

            # ls(["testdb"]) → tables
            resp = client.post("/api/connectors/mysql/catalog/ls", json={"path": ["testdb"]})
            nodes = resp.get_json()["nodes"]
            table_names = [n["name"] for n in nodes]
            self.assertIn("products", table_names)

    # ==============================================================
    # Data preview + import
    # ==============================================================

    def test_preview(self):
        cfg = get_mysql_config()
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/mysql/auth/connect", json={"params": cfg})
            resp = client.post("/api/connectors/mysql/data/preview", json={
                "source_table": "products",
                "size": 5,
            })
            data = resp.get_json()
            self.assertEqual(data["status"], "success")
            self.assertLessEqual(data["row_count"], 5)

    def test_import_and_refresh(self):
        cfg = get_mysql_config()
        app, client, source = _make_app_and_client()
        workspace_root = self._workspace_root_path()

        from data_formulator.datalake.workspace import Workspace
        workspace = Workspace(self._identity, root_dir=workspace_root)

        with patch.object(type(source), "_get_identity", return_value=self._identity), \
             patch("data_formulator.data_connector.get_identity_id", return_value=self._identity), \
             patch("data_formulator.data_connector.get_workspace", return_value=workspace):
            client.post("/api/connectors/mysql/auth/connect", json={"params": cfg})

            resp = client.post("/api/connectors/mysql/data/import", json={
                "source_table": "products",
                "table_name": "mysql_products",
                "import_options": {"size": 50},
            })
            data = resp.get_json()
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["table_name"], "mysql_products")
            self.assertGreater(data["row_count"], 0)

            # Verify workspace
            self.assertIn("mysql_products", workspace.list_tables())

            # Refresh
            resp = client.post("/api/connectors/mysql/data/refresh", json={
                "table_name": "mysql_products",
            })
            self.assertEqual(resp.get_json()["status"], "success")

    # ==============================================================
    # Flat listing
    # ==============================================================

    def test_list_tables_flat(self):
        cfg = get_mysql_config()
        app, client, source = _make_app_and_client()

        with patch.object(type(source), "_get_identity", return_value=self._identity):
            client.post("/api/connectors/mysql/auth/connect", json={"params": cfg})
            resp = client.post("/api/connectors/mysql/catalog/list_tables", json={})
            data = resp.get_json()
            names = [t["name"] for t in data["tables"]]
            self.assertTrue(any("products" in n for n in names))


class TestMySQLConnectedSourceStatic(unittest.TestCase):

    def test_hierarchy(self):
        from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader
        h = MySQLDataLoader.catalog_hierarchy()
        keys = [l["key"] for l in h]
        self.assertEqual(keys, ["database", "table"])

    def test_frontend_config_with_pinned_database(self):
        from data_formulator.data_connector import DataConnector
        from data_formulator.data_loader.mysql_data_loader import MySQLDataLoader

        source = DataConnector.from_loader(
            MySQLDataLoader,
            source_id="mysql_test",
            display_name="MySQL Test",
            default_params={"host": "db.corp", "database": "analytics"},
        )
        cfg = source.get_frontend_config()
        self.assertEqual(cfg["pinned_params"]["database"], "analytics")
        eff_keys = [h["key"] for h in cfg["effective_hierarchy"]]
        self.assertNotIn("database", eff_keys)
        self.assertIn("table", eff_keys)
