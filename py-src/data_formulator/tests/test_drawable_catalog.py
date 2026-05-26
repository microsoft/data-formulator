from data_formulator.agents.drawable_catalog import build_drawable_catalog


def test_build_drawable_catalog_qc_has_qc_charts(qc_full_metas):
    entries = build_drawable_catalog(qc_full_metas, "qc")
    assert len(entries) > 0
    chart_types = {e.chart_type for e in entries}
    assert "QC Trend Line" in chart_types


def test_build_drawable_catalog_generic_excludes_qc(sales_long_metas):
    entries = build_drawable_catalog(sales_long_metas, "generic")
    assert len(entries) > 0
    assert all(not e.chart_type.startswith("QC ") for e in entries)


def test_build_drawable_catalog_top_k(qc_full_metas):
    entries = build_drawable_catalog(qc_full_metas, "qc", top_k=3)
    assert len(entries) <= 3

