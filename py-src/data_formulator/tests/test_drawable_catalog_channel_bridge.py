from data_formulator.agents.drawable_catalog import build_drawable_catalog
from data_formulator.agents.field_metadata import FieldMeta


def _sample_metas():
    return {
        "date": FieldMeta(
            name="date",
            sql_type="date",
            cardinality=30,
            null_ratio=0.0,
            cardinality_class="mid",
            is_temporal=True,
            is_sequential=False,
            is_quantitative=False,
            is_categorical=False,
        ),
        "cluster": FieldMeta(
            name="cluster",
            sql_type="int",
            cardinality=6,
            null_ratio=0.0,
            cardinality_class="low",
            is_temporal=False,
            is_sequential=False,
            is_quantitative=False,
            is_categorical=True,
        ),
        "q1": FieldMeta(
            name="q1",
            sql_type="float",
            cardinality=100,
            null_ratio=0.0,
            cardinality_class="high",
            is_temporal=False,
            is_sequential=False,
            is_quantitative=True,
            is_categorical=False,
        ),
        "q2": FieldMeta(
            name="q2",
            sql_type="float",
            cardinality=100,
            null_ratio=0.0,
            cardinality_class="high",
            is_temporal=False,
            is_sequential=False,
            is_quantitative=True,
            is_categorical=False,
        ),
    }


def test_catalog_includes_pie_radial_threshold_with_template_channels():
    entries = build_drawable_catalog(_sample_metas(), "generic", top_k=None)
    by_chart = {e.chart_type: e for e in entries}

    assert "Pie Chart" in by_chart
    assert set(by_chart["Pie Chart"].encoding.keys()) >= {"color", "theta"}

    assert "Radial Plot" in by_chart
    assert set(by_chart["Radial Plot"].encoding.keys()) >= {"color", "theta"}

    assert "Threshold Bar Chart" in by_chart
    assert set(by_chart["Threshold Bar Chart"].encoding.keys()) >= {
        "x",
        "y",
        "threshold",
    }

