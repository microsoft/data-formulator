"""Tests for ImportedFrom and Derivation metadata models."""

from __future__ import annotations

import pytest
from datetime import datetime, timezone

from data_formulator.datalake.workspace_metadata import (
    ImportedFrom,
    Derivation,
)


pytestmark = [pytest.mark.backend]


# ── ImportedFrom tests ───────────────────────────────────────────────

class TestImportedFrom:
    def test_data_loader_roundtrip(self):
        orig = ImportedFrom(
            source_type="data_loader",
            ingested_at=datetime(2024, 11, 1, 10, 30, tzinfo=timezone.utc),
            loader_type="mysql",
            params={"host": "localhost", "port": 3306, "user": "root", "database": "mydb"},
            source_table="sales",
            source_query=None,
        )
        d = orig.to_dict()
        restored = ImportedFrom.from_dict(d)
        assert restored.source_type == "data_loader"
        assert restored.loader_type == "mysql"
        assert restored.params["host"] == "localhost"
        assert restored.source_table == "sales"
        assert "password" not in d

    def test_upload_roundtrip(self):
        orig = ImportedFrom(
            source_type="upload",
            ingested_at=datetime(2024, 11, 1, tzinfo=timezone.utc),
            original_name="sales_2024.csv",
        )
        d = orig.to_dict()
        restored = ImportedFrom.from_dict(d)
        assert restored.source_type == "upload"
        assert restored.original_name == "sales_2024.csv"
        assert "loader_type" not in d

    def test_url_roundtrip(self):
        orig = ImportedFrom(
            source_type="url",
            ingested_at=datetime(2024, 11, 1, tzinfo=timezone.utc),
            url="https://data.gov/api/v1/sales.csv",
        )
        d = orig.to_dict()
        restored = ImportedFrom.from_dict(d)
        assert restored.url == "https://data.gov/api/v1/sales.csv"

    def test_stream_roundtrip(self):
        orig = ImportedFrom(
            source_type="stream",
            ingested_at=datetime(2024, 11, 1, tzinfo=timezone.utc),
            url="https://api.example.com/v1/live",
            refresh_interval_seconds=300,
        )
        d = orig.to_dict()
        restored = ImportedFrom.from_dict(d)
        assert restored.refresh_interval_seconds == 300

    def test_paste_roundtrip(self):
        orig = ImportedFrom(
            source_type="paste",
            ingested_at=datetime(2024, 11, 1, tzinfo=timezone.utc),
        )
        d = orig.to_dict()
        assert d == {"source_type": "paste", "ingested_at": "2024-11-01T00:00:00+00:00"}
        restored = ImportedFrom.from_dict(d)
        assert restored.source_type == "paste"

    def test_example_roundtrip(self):
        orig = ImportedFrom(
            source_type="example",
            ingested_at=datetime(2024, 11, 1, tzinfo=timezone.utc),
            dataset_name="df_movies",
        )
        d = orig.to_dict()
        restored = ImportedFrom.from_dict(d)
        assert restored.dataset_name == "df_movies"


# ── Derivation tests ────────────────────────────────────────────────

class TestDerivation:
    def test_roundtrip(self):
        orig = Derivation(
            source_tables=["sales_2024"],
            description="Grouped by region",
            code="import pandas as pd\ndf = pd.read_parquet('data/sales.parquet')",
            created_at=datetime(2025, 3, 15, 10, 15, tzinfo=timezone.utc),
        )
        d = orig.to_dict()
        restored = Derivation.from_dict(d)
        assert restored.source_tables == ["sales_2024"]
        assert "pd.read_parquet" in restored.code
