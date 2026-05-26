"""
Integration tests for the SQLDataRecAgent compatibility pipeline.

These tests exercise the EARLY REJECT (pre-LLM) and POST VALIDATE (post-LLM)
branches added in M3. We mock the LLM client so we never make a network call;
DuckDB is real (in-memory).

Three scenarios per branch:
    EARLY REJECT
        - user picks qc_trend_line on non-QC data → R2
        - user picks bar but data has only quantitative columns → R1
        - user picks valid chart → no early reject, LLM called

    POST VALIDATE
        - LLM returns a bar with INDEX-as-x on QC data → REJECT R3/R1
        - LLM returns valid encoding → no reject, SQL executed
        - LLM returns qc_chart → strict validator SKIPS (qc_chart_config
          handles those separately) so no double-reject

Feature flag:
    - ENABLE_STRICT_CHART_VALIDATION=false → both branches inactive
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from data_formulator.agents.agent_sql_data_rec import SQLDataRecAgent


# ─────────────────────────────────────────────────────────────────────────────
# Test scaffolding
# ─────────────────────────────────────────────────────────────────────────────


def _mock_llm_response(content: str) -> SimpleNamespace:
    """Build a minimal LiteLLM-like response object."""
    choice = SimpleNamespace(
        message=SimpleNamespace(role="assistant", content=content)
    )
    return SimpleNamespace(choices=[choice])


def _mock_client(response_content: str):
    """Build a MagicMock client whose .get_completion returns a canned response."""
    client = MagicMock()
    client.get_completion.return_value = _mock_llm_response(response_content)
    return client


def _make_qc_table(conn, name: str = "qc_data", n_rows: int = 50):
    """Create a real DuckDB table with the QC schema for integration testing."""
    conn.execute(f'''
        CREATE TABLE "{name}" AS
        SELECT
            row_number() OVER () AS "INDEX",
            DATE '2026-01-01' + INTERVAL (row_number() OVER ()) DAY AS "QCDATE",
            CASE (row_number() OVER ()) % 3 WHEN 0 THEN 'A' WHEN 1 THEN 'B' ELSE 'C' END AS "QCSHIFT",
            100.0 + (random() * 20.0) AS "VALUE",
            CASE (row_number() OVER ()) % 4
                WHEN 0 THEN 'PARAM_X' WHEN 1 THEN 'PARAM_Y'
                WHEN 2 THEN 'PARAM_Z' ELSE 'PARAM_W' END AS "QCSTDPARAMNAME",
            100.0 AS "TARGET",
            90.0 AS "LL",
            110.0 AS "UL",
            85.0 AS "ARLL",
            115.0 AS "ARUL"
        FROM range({n_rows})
    ''')


def _make_sales_table(conn, name: str = "sales", n_rows: int = 50):
    conn.execute(f'''
        CREATE TABLE "{name}" AS
        SELECT
            DATE '2026-01-01' + INTERVAL (row_number() OVER ()) DAY AS "date",
            CASE (row_number() OVER ()) % 4
                WHEN 0 THEN 'A' WHEN 1 THEN 'B' WHEN 2 THEN 'C' ELSE 'D' END AS "product",
            (random() * 1000.0) AS "revenue"
        FROM range({n_rows})
    ''')


def _make_agent_with_canned_response(conn, response_content: str) -> SQLDataRecAgent:
    """Build an SQLDataRecAgent whose LLM is mocked."""
    client = _mock_client(response_content)
    guard_client = _mock_client("")  # not exercised in these tests
    agent = SQLDataRecAgent(client=client, conn=conn, guard_client=guard_client)
    # Bypass the guard by stubbing it to always pass
    agent.guard = MagicMock()
    agent.guard.validate.return_value = {"ok": True}
    return agent


# ─────────────────────────────────────────────────────────────────────────────
# EARLY REJECT tests
# ─────────────────────────────────────────────────────────────────────────────


class TestEarlyReject:
    def test_qc_chart_on_non_qc_data_rejects_r2(self, conn, monkeypatch):
        """User picks qc_trend_line on a sales table → R2 reject before LLM."""
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "true")
        _make_sales_table(conn)

        agent = _make_agent_with_canned_response(conn, "{}\n```sql\nSELECT 1\n```")
        results = agent.run(
            input_tables=[{"name": "sales", "rows": []}],
            description="show me trend",
            user_preferred_chart_type="qc_trend_line",
        )

        assert len(results) == 1
        assert results[0]["status"] == "rejected_incompatible"
        assert results[0]["reject"]["reason_code"] == "R2"
        # LLM must NOT have been called for an early reject
        agent.client.get_completion.assert_not_called()

    def test_bar_on_numeric_only_data_rejects_r1(self, conn, monkeypatch):
        """A table with only numeric columns → bar.x cannot be filled → R1."""
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "true")
        conn.execute('''
            CREATE TABLE "numeric_only" AS
            SELECT
                CAST((random() * 100) AS DOUBLE) AS "a",
                CAST((random() * 100) AS DOUBLE) AS "b",
                CAST((random() * 100) AS DOUBLE) AS "c"
            FROM range(30)
        ''')

        agent = _make_agent_with_canned_response(conn, "{}\n```sql\nSELECT 1\n```")
        results = agent.run(
            input_tables=[{"name": "numeric_only", "rows": []}],
            description="bar chart please",
            user_preferred_chart_type="bar",
        )

        assert results[0]["status"] == "rejected_incompatible"
        assert results[0]["reject"]["reason_code"] in ("R1", "R4")
        agent.client.get_completion.assert_not_called()

    def test_compatible_chart_passes_through_to_llm(self, conn, monkeypatch):
        """A compatible chart_type+data combo does NOT early-reject."""
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "true")
        _make_qc_table(conn)

        # Mock returns a valid encoding so post-validate passes too.
        llm_response = (
            '```json\n'
            '{"chart_type": "line", "chart_encodings": {"x": "QCDATE", "y": "VALUE"}, '
            '"output_fields": ["INDEX", "QCDATE", "VALUE"]}\n'
            '```\n'
            '```sql\n'
            'SELECT * FROM qc_data\n'
            '```'
        )
        agent = _make_agent_with_canned_response(conn, llm_response)
        results = agent.run(
            input_tables=[{"name": "qc_data", "rows": []}],
            description="show value over time",
            user_preferred_chart_type="line",
        )

        # LLM was called
        agent.client.get_completion.assert_called_once()
        # And the result is not a reject
        assert results[0]["status"] != "rejected_incompatible"


# ─────────────────────────────────────────────────────────────────────────────
# POST VALIDATE tests
# ─────────────────────────────────────────────────────────────────────────────


class TestPostValidate:
    def test_post_validate_rejects_bar_with_index_x(self, conn, monkeypatch):
        """LLM returns bar with x=INDEX on QC data → post-validate REJECTS."""
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "true")
        _make_qc_table(conn)

        llm_response = (
            '```json\n'
            '{"chart_type": "bar", "chart_encodings": {"x": "INDEX", "y": "VALUE"}, '
            '"output_fields": ["INDEX", "VALUE"]}\n'
            '```\n'
            '```sql\n'
            'SELECT "INDEX", "VALUE" FROM qc_data\n'
            '```'
        )
        agent = _make_agent_with_canned_response(conn, llm_response)
        # Don't pass user_preferred_chart_type — let the LLM "infer" bar
        results = agent.run(
            input_tables=[{"name": "qc_data", "rows": []}],
            description="show value distribution",
        )

        assert results[0]["status"] == "rejected_incompatible"
        # bar.x rejects sequential (INDEX is sequential) OR triggers
        # cardinality_explosion (50 distinct > max_distinct allowed for bar).
        # Both are correct reject codes — either is fine here.
        assert results[0]["reject"]["reason_code"] in ("R1", "R3")
        # LLM debug info should be preserved
        assert results[0]["refined_goal"].get("_llm_chart_type") == "bar"

    def test_post_validate_passes_valid_encoding(self, conn, monkeypatch):
        """LLM returns line + (QCDATE, VALUE) → no reject."""
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "true")
        _make_qc_table(conn)

        llm_response = (
            '```json\n'
            '{"chart_type": "line", "chart_encodings": {"x": "QCDATE", "y": "VALUE"}, '
            '"output_fields": ["INDEX", "QCDATE", "VALUE"]}\n'
            '```\n'
            '```sql\n'
            'SELECT * FROM qc_data\n'
            '```'
        )
        agent = _make_agent_with_canned_response(conn, llm_response)
        results = agent.run(
            input_tables=[{"name": "qc_data", "rows": []}],
            description="value over time",
        )

        assert results[0]["status"] != "rejected_incompatible"

    def test_post_validate_skips_qc_charts(self, conn, monkeypatch):
        """qc_* charts are handled by qc_chart_config (auto-fix); the strict
        validator skips them to avoid double-validation conflicts."""
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "true")
        _make_qc_table(conn)

        # Intentionally give qc_trend_line a weird encoding — qc_chart_config
        # will auto-fix, my new validator should NOT also reject it.
        llm_response = (
            '```json\n'
            '{"chart_type": "qc_trend_line", "chart_encodings": {"x": "INDEX", "y": "VALUE"}, '
            '"output_fields": ["INDEX", "QCDATE", "QCSHIFT", "VALUE"]}\n'
            '```\n'
            '```sql\n'
            'SELECT * FROM qc_data\n'
            '```'
        )
        agent = _make_agent_with_canned_response(conn, llm_response)
        results = agent.run(
            input_tables=[{"name": "qc_data", "rows": []}],
            description="QC trend",
        )

        # NOT rejected_incompatible — qc_chart_config's fix_qc_chart_encodings
        # handles the encoding correction.
        assert results[0]["status"] != "rejected_incompatible"


# ─────────────────────────────────────────────────────────────────────────────
# Feature flag tests
# ─────────────────────────────────────────────────────────────────────────────


class TestFeatureFlag:
    def test_flag_off_disables_early_reject(self, conn, monkeypatch):
        """ENABLE_STRICT_CHART_VALIDATION=false → no early reject; LLM IS called."""
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "false")
        _make_sales_table(conn)

        llm_response = (
            '```json\n'
            '{"chart_type": "qc_trend_line", "chart_encodings": {}, '
            '"output_fields": []}\n'
            '```\n'
            '```sql\n'
            'SELECT 1\n'
            '```'
        )
        agent = _make_agent_with_canned_response(conn, llm_response)
        results = agent.run(
            input_tables=[{"name": "sales", "rows": []}],
            description="trend",
            user_preferred_chart_type="qc_trend_line",
        )

        # With flag off, early reject is skipped → LLM was called
        agent.client.get_completion.assert_called_once()
        # The result must NOT have rejected_incompatible status
        assert results[0]["status"] != "rejected_incompatible"

    def test_flag_off_disables_post_validate(self, conn, monkeypatch):
        """ENABLE_STRICT_CHART_VALIDATION=false → post-validate skipped."""
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "false")
        _make_qc_table(conn)

        # Bar with INDEX as x — strict mode would reject; flag off → allowed.
        llm_response = (
            '```json\n'
            '{"chart_type": "bar", "chart_encodings": {"x": "INDEX", "y": "VALUE"}, '
            '"output_fields": ["INDEX", "VALUE"]}\n'
            '```\n'
            '```sql\n'
            'SELECT "INDEX", "VALUE" FROM qc_data\n'
            '```'
        )
        agent = _make_agent_with_canned_response(conn, llm_response)
        results = agent.run(
            input_tables=[{"name": "qc_data", "rows": []}],
            description="bar chart",
        )

        assert results[0]["status"] != "rejected_incompatible"


# ─────────────────────────────────────────────────────────────────────────────
# Sanity: domain detection inside the agent
# ─────────────────────────────────────────────────────────────────────────────


class TestDomainDetection:
    def test_qc_table_detected_as_qc(self, conn, monkeypatch):
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "true")
        _make_qc_table(conn)

        # If domain detection were wrong (treating QC as generic), the early
        # reject would pass any QC chart. We confirm qc_trend_line is NOT
        # rejected when the QC fixture is used.
        llm_response = (
            '```json\n'
            '{"chart_type": "qc_trend_line", "chart_encodings": {"INDEX":"INDEX","VALUE":"VALUE","QCDATE":"QCDATE","QCSHIFT":"QCSHIFT","color":"QCSTDPARAMNAME"}, '
            '"output_fields": ["INDEX","VALUE","QCDATE","QCSHIFT","QCSTDPARAMNAME"]}\n'
            '```\n'
            '```sql\n'
            'SELECT * FROM qc_data\n'
            '```'
        )
        agent = _make_agent_with_canned_response(conn, llm_response)
        results = agent.run(
            input_tables=[{"name": "qc_data", "rows": []}],
            description="qc trend",
            user_preferred_chart_type="qc_trend_line",
        )
        # Domain=qc → qc_trend_line passes early reject
        assert results[0]["status"] != "rejected_incompatible"

    def test_sales_table_detected_as_generic(self, conn, monkeypatch):
        monkeypatch.setenv("ENABLE_STRICT_CHART_VALIDATION", "true")
        _make_sales_table(conn)

        agent = _make_agent_with_canned_response(conn, "")
        results = agent.run(
            input_tables=[{"name": "sales", "rows": []}],
            description="trend",
            user_preferred_chart_type="qc_trend_line",
        )
        # Domain=generic → qc_trend_line REJECTED via R2
        assert results[0]["status"] == "rejected_incompatible"
        assert results[0]["reject"]["reason_code"] == "R2"
