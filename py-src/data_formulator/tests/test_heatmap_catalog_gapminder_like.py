from data_formulator.agents.drawable_catalog import build_drawable_catalog
from data_formulator.agents.field_metadata import FieldMeta


def test_heatmap_available_for_gapminder_like_schema():
    metas = {
        "year": FieldMeta(
            name="year",
            sql_type="int64",
            cardinality=11,
            null_ratio=0.0,
            cardinality_class="low",
            is_temporal=False,  # common real-world inference: year stored as numeric
            is_sequential=False,
            is_quantitative=True,
            is_categorical=False,
        ),
        "country": FieldMeta(
            name="country",
            sql_type="object",
            cardinality=62,
            null_ratio=0.0,
            cardinality_class="mid",
            is_temporal=False,
            is_sequential=False,
            is_quantitative=False,
            is_categorical=True,
        ),
        "life_expect": FieldMeta(
            name="life_expect",
            sql_type="float64",
            cardinality=614,
            null_ratio=0.0,
            cardinality_class="high",
            is_temporal=False,
            is_sequential=False,
            is_quantitative=True,
            is_categorical=False,
        ),
    }
    entries = build_drawable_catalog(metas, "generic", top_k=None)
    heat = [e for e in entries if e.chart_type == "Heat Map"]
    assert len(heat) > 0
    assert {"x", "y", "color"}.issubset(set(heat[0].encoding.keys()))

