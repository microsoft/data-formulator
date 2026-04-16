"""Integration tests for the /api/tables/parse-file endpoint."""
from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
import pytest
from flask import Flask

from data_formulator.routes.tables import tables_bp

pytestmark = [pytest.mark.backend]

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "excel"


@pytest.fixture()
def client():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(tables_bp)
    with app.test_client() as c:
        yield c


def test_parse_xls_returns_sheet_data(client):
    xls_path = FIXTURE_DIR / "test_cn.xls"
    if not xls_path.exists():
        pytest.skip("test_cn.xls fixture not found")

    with open(xls_path, "rb") as f:
        resp = client.post(
            "/api/tables/parse-file",
            data={"file": (f, "test_cn.xls")},
            content_type="multipart/form-data",
        )

    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "success"
    assert len(data["sheets"]) >= 1

    sheet = data["sheets"][0]
    assert sheet["row_count"] > 0
    assert len(sheet["columns"]) > 0
    assert len(sheet["data"]) == sheet["row_count"]


def test_parse_file_rejects_missing_file(client):
    resp = client.post("/api/tables/parse-file")
    assert resp.status_code == 400
    assert resp.get_json()["status"] == "error"


def test_parse_file_rejects_unsupported_format(client):
    fake = io.BytesIO(b"hello world")
    resp = client.post(
        "/api/tables/parse-file",
        data={"file": (fake, "data.txt")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400


def test_parse_csv_via_endpoint(client):
    csv_content = "name,age\nAlice,30\nBob,25\n"
    buf = io.BytesIO(csv_content.encode("utf-8"))
    resp = client.post(
        "/api/tables/parse-file",
        data={"file": (buf, "people.csv")},
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["status"] == "success"
    assert data["sheets"][0]["row_count"] == 2
    assert "name" in data["sheets"][0]["columns"]
