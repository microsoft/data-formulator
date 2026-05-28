from __future__ import annotations

import datetime as dt

import pandas as pd

from data_formulator.agents.field_metadata import (
    compute_field_metadata,
    compute_from_dataframe,
)


def test_pandas_and_duckdb_paths_agree_on_core_semantics(conn, make_table):
    rows = []
    for i in range(1, 121):
        rows.append(
            (
                i,  # INDEX-like sequential
                i + 1000,  # id-like non-sequential, high-cardinality
                dt.datetime(2026, 1, 1) + dt.timedelta(days=i),
                ["A", "B", "C"][i % 3],
                float(i) * 1.25,
            )
        )

    make_table(
        "t",
        {
            "INDEX": "INTEGER",
            "customer_id": "INTEGER",
            "event_time": "TIMESTAMP",
            "shift": "VARCHAR",
            "value": "DOUBLE",
        },
        rows,
    )

    duckdb_metas = compute_field_metadata(conn, "t")

    df = pd.DataFrame(
        rows,
        columns=["INDEX", "customer_id", "event_time", "shift", "value"],
    )
    df["event_time"] = pd.to_datetime(df["event_time"])
    pandas_metas = compute_from_dataframe(df)

    for col in duckdb_metas:
        a = pandas_metas[col]
        b = duckdb_metas[col]
        assert a.cardinality_class == b.cardinality_class
        assert a.is_temporal == b.is_temporal
        assert a.is_sequential == b.is_sequential
        assert a.is_quantitative == b.is_quantitative
        assert a.is_categorical == b.is_categorical
        assert a.qc_role == b.qc_role
        assert a.looks_like_id == b.looks_like_id


def test_compute_from_dataframe_empty_returns_empty():
    df = pd.DataFrame(columns=["a", "b"])
    assert compute_from_dataframe(df) == {}

