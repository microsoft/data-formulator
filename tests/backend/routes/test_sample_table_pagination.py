"""Tests for the sample-table endpoint's offset/limit pagination and sorting.

Verifies that:
- offset parameter correctly skips rows
- sorted results with offset return correct pages
- offset beyond total rows returns empty results
- backward compatibility: requests without offset still work
"""
from __future__ import annotations

import json
import shutil
from unittest.mock import patch

import pandas as pd
import pytest
from flask import Flask

from data_formulator.datalake.workspace import Workspace
from data_formulator.routes.tables import tables_bp

pytestmark = [pytest.mark.backend]


@pytest.fixture()
def tmp_workspace(tmp_path):
    ws = Workspace("test-user", root_dir=tmp_path)
    yield ws
    shutil.rmtree(tmp_path, ignore_errors=True)


@pytest.fixture()
def client(tmp_workspace):
    from data_formulator.error_handler import register_error_handlers

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(tables_bp)
    register_error_handlers(app)
    with patch("data_formulator.routes.tables._get_workspace", return_value=tmp_workspace):
        with app.test_client() as c:
            yield c


@pytest.fixture()
def seeded_table(tmp_workspace):
    """Create a table with 50 rows: value 0..49, name a..."""
    df = pd.DataFrame({
        "value": list(range(50)),
        "name": [f"item_{i:02d}" for i in range(50)],
    })
    tmp_workspace.write_parquet(df, "test_data")
    return "test_data"


def _sample(client, table: str, **kwargs):
    payload = {"table": table, **kwargs}
    resp = client.post(
        "/api/tables/sample-table",
        data=json.dumps(payload),
        content_type="application/json",
    )
    assert resp.status_code == 200
    return resp.get_json()["data"]


class TestSampleTablePagination:
    """Offset-based pagination for the sample-table endpoint."""

    def test_no_offset_returns_first_page(self, client, seeded_table):
        result = _sample(client, seeded_table, size=10, method="head",
                         order_by_fields=["value"])
        rows = result["rows"]
        assert len(rows) == 10
        assert rows[0]["value"] == 0
        assert rows[9]["value"] == 9

    def test_offset_skips_rows(self, client, seeded_table):
        result = _sample(client, seeded_table, size=10, offset=10,
                         method="head", order_by_fields=["value"])
        rows = result["rows"]
        assert len(rows) == 10
        assert rows[0]["value"] == 10
        assert rows[9]["value"] == 19

    def test_offset_with_desc_sort(self, client, seeded_table):
        result = _sample(client, seeded_table, size=5, offset=0,
                         method="bottom", order_by_fields=["value"])
        rows = result["rows"]
        assert len(rows) == 5
        assert rows[0]["value"] == 49
        assert rows[4]["value"] == 45

    def test_offset_with_desc_sort_page2(self, client, seeded_table):
        result = _sample(client, seeded_table, size=5, offset=5,
                         method="bottom", order_by_fields=["value"])
        rows = result["rows"]
        assert len(rows) == 5
        assert rows[0]["value"] == 44
        assert rows[4]["value"] == 40

    def test_offset_beyond_total_returns_empty(self, client, seeded_table):
        result = _sample(client, seeded_table, size=10, offset=100,
                         method="head", order_by_fields=["value"])
        assert len(result["rows"]) == 0

    def test_total_row_count_consistent_across_pages(self, client, seeded_table):
        r1 = _sample(client, seeded_table, size=10, offset=0,
                      method="head", order_by_fields=["value"])
        r2 = _sample(client, seeded_table, size=10, offset=10,
                      method="head", order_by_fields=["value"])
        assert r1["total_row_count"] == r2["total_row_count"] == 50

    def test_backward_compat_no_offset(self, client, seeded_table):
        """Requests without offset param should default to 0 (no skipping)."""
        result = _sample(client, seeded_table, size=5, method="head",
                         order_by_fields=["value"])
        rows = result["rows"]
        assert len(rows) == 5
        assert rows[0]["value"] == 0

    def test_pages_cover_all_rows_without_overlap(self, client, seeded_table):
        """Paginating through all rows should yield exactly 50 unique values."""
        all_values = []
        offset = 0
        while True:
            result = _sample(client, seeded_table, size=15, offset=offset,
                             method="head", order_by_fields=["value"])
            rows = result["rows"]
            if not rows:
                break
            all_values.extend(r["value"] for r in rows)
            offset += len(rows)
        assert all_values == list(range(50))
