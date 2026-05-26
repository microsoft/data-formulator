"""
Unit tests for the strict QC-data detector in qc_chart_config.

The fix targets a real-world false positive: business data with columns named
TARGET (sales target) and LL (low limit) being mis-detected as QC data,
causing QC chart rules to apply where they shouldn't.

Detection rules (see qc_chart_config.is_qc_data docstring):
    1. Has TARGET
    2. Has at least one of {LL, UL, ARLL, ARUL}
    3. Has at least one of {QCDATE, QCSHIFT, QCSTDPARAMNAME, SLIPNO}

All three must be true. The signature column (rule 3) is what prevents the
false positive.
"""

from __future__ import annotations

import pytest

from data_formulator.agents.qc_chart_config import is_qc_data


# ─────────────────────────────────────────────────────────────────────────────
# Positive cases — should detect as QC
# ─────────────────────────────────────────────────────────────────────────────


class TestPositive:
    def test_full_qc_schema(self):
        cols = ["INDEX", "QCDATE", "QCSHIFT", "VALUE", "QCSTDPARAMNAME",
                "TARGET", "LL", "UL", "ARLL", "ARUL", "SLIPNO", "ITEMNAME"]
        assert is_qc_data(cols) is True

    def test_minimal_with_qcdate(self):
        """TARGET + LL + QCDATE — minimum signature for QC."""
        assert is_qc_data(["TARGET", "LL", "QCDATE", "VALUE"]) is True

    def test_minimal_with_qcshift(self):
        assert is_qc_data(["TARGET", "UL", "QCSHIFT", "VALUE"]) is True

    def test_minimal_with_qcstdparamname(self):
        assert is_qc_data(["TARGET", "ARLL", "QCSTDPARAMNAME", "VALUE"]) is True

    def test_minimal_with_slipno(self):
        assert is_qc_data(["TARGET", "ARUL", "SLIPNO", "VALUE"]) is True

    def test_case_insensitive(self):
        """Column names compared case-insensitively."""
        assert is_qc_data(["target", "ll", "qcdate", "value"]) is True

    def test_mixed_case_with_signature(self):
        assert is_qc_data(["Target", "Ul", "QcShift"]) is True


# ─────────────────────────────────────────────────────────────────────────────
# Negative cases — should NOT detect as QC
# ─────────────────────────────────────────────────────────────────────────────


class TestNegative:
    def test_empty_columns(self):
        assert is_qc_data([]) is False

    def test_only_target(self):
        assert is_qc_data(["TARGET", "VALUE"]) is False

    def test_target_plus_limit_no_signature(self):
        """The critical false-positive guard: TARGET + LL but no QC signature
        column → NOT QC. This is typically sales/finance data with
        unfortunate column names."""
        assert is_qc_data(["TARGET", "LL", "revenue", "product", "date"]) is False

    def test_signature_only_no_target(self):
        """QCDATE alone is not enough — TARGET is also required."""
        assert is_qc_data(["QCDATE", "QCSHIFT", "VALUE"]) is False

    def test_signature_plus_limits_no_target(self):
        assert is_qc_data(["QCDATE", "LL", "UL", "VALUE"]) is False

    def test_target_plus_signature_no_limits(self):
        """TARGET + QCDATE but no control-limit column → not full QC."""
        assert is_qc_data(["TARGET", "QCDATE", "VALUE"]) is False

    def test_only_limits_no_target_no_signature(self):
        assert is_qc_data(["LL", "UL", "ARLL", "ARUL"]) is False

    def test_random_business_columns(self):
        """Typical sales schema — must not be detected."""
        cols = ["order_id", "customer_id", "product_name", "quantity",
                "unit_price", "total_amount", "order_date", "region"]
        assert is_qc_data(cols) is False
