import pandas as pd
import numpy as np
from typing import Any
import vl_convert as vlc
import base64
import logging

from data_formulator.agents.semantic_types import infer_vl_type_from_name
from data_formulator.workflows.chart_semantics import (
    resolve_channel_semantics,
    resolve_vl_type,
    is_registered,
    ChannelSemantics,
    convert_temporal_data,
    _looks_like_date,
    _looks_like_year_integers,
)

logger = logging.getLogger(__name__)


def field_metadata_to_semantic_types(
    field_metadata: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """Convert agent ``field_metadata`` to the ``semantic_types`` dict
    expected by :func:`assemble_vegailte_chart`.

    ``field_metadata`` comes from the LLM's ``refined_goal.field_metadata``
    and has the shape::

        {
            "Revenue": {"semantic_type": "Revenue", "unit": "USD"},
            "Month":   {"semantic_type": "Month"},
        }

    The returned dict maps field names to either a plain string
    (the semantic type name) or a dict with ``type``, ``unit``,
    and ``intrinsic_domain`` keys — exactly what ``assemble_vegailte_chart``
    already accepts.
    """
    if not field_metadata:
        return None

    result: dict[str, Any] = {}
    for field_name, meta in field_metadata.items():
        if isinstance(meta, str):
            result[field_name] = meta
            continue
        if not isinstance(meta, dict):
            continue
        sem_type = meta.get("semantic_type")
        if not sem_type:
            continue
        extras = {}
        if "unit" in meta and meta["unit"]:
            extras["unit"] = meta["unit"]
        if "intrinsic_domain" in meta and meta["intrinsic_domain"]:
            extras["intrinsic_domain"] = meta["intrinsic_domain"]
        if extras:
            result[field_name] = {"type": sem_type, **extras}
        else:
            result[field_name] = sem_type
    return result if result else None


def resolve_field_type(
    series: pd.Series,
    field_name: str | None = None,
) -> str:
    """
    Resolve the Vega-Lite type for a field.  Priority:
      1. Column-name heuristic (catches derived columns like avg_revenue, year, etc.)
      2. Pandas dtype detection (fallback)
    
    Parameters:
    - series: the pandas Series for the field
    - field_name: column name (used for name heuristics)
    
    Returns one of: 'quantitative', 'nominal', 'ordinal', 'temporal'
    """
    # 1. Try column-name heuristic (useful for derived columns)
    if field_name:
        inferred = infer_vl_type_from_name(field_name)
        if inferred:
            return inferred
    
    # 2. Fall back to pandas-based detection
    return detect_field_type(series)


def detect_field_type(series: pd.Series) -> str:
    """
    Detect the appropriate Vega-Lite field type for a pandas Series.
    Returns one of: 'quantitative', 'nominal', 'ordinal', 'temporal'
    """
    if pd.api.types.is_datetime64_any_dtype(series):
        return 'temporal'
    if pd.api.types.is_bool_dtype(series):
        return 'nominal'
    if pd.api.types.is_numeric_dtype(series):
        # Check if values look like 4-digit years (1000-2999).
        # Year integers should be ordinal (discrete labels), not quantitative
        # (which causes VL to format them with SI prefixes like ".024").
        non_null_vals = series.dropna().tolist()
        if non_null_vals and _looks_like_year_integers(non_null_vals):
            return 'ordinal'
        # Check if it looks like a discrete categorical variable
        unique_count = series.nunique()
        total_count = len(series)
        if unique_count <= 20 and unique_count / total_count < 0.5:
            return 'ordinal'
        return 'quantitative'
    # String or object type — check for date strings
    non_null = series.dropna().head(30).tolist()
    if non_null:
        str_vals = [v for v in non_null if isinstance(v, str)]
        if str_vals and len(str_vals) >= len(non_null) * 0.8:
            date_count = sum(1 for s in str_vals if _looks_like_date(s))
            if date_count >= len(str_vals) * 0.7:
                return 'temporal'
    unique_count = series.nunique()
    if unique_count <= 50:
        return 'nominal'
    return 'nominal'


# Chart Templates
CHART_TEMPLATES = [
    {
        "chart": "point",
        "mark": "circle",
        "channels": ["x", "y", "color", "opacity", "size", "shape", "column", "row"]
    },
    {
        "chart": "line",
        "mark": "line",
        "channels": ["x", "y", "color", "opacity", "detail", "column", "row"]
    },
    {
        "chart": "dotted_line",
        "mark": {"type": "line", "point": True},
        "channels": ["x", "y", "color", "detail", "column", "row"]
    },
    {
        "chart": "bar",
        "mark": "bar",
        "channels": ["x", "y", "color", "opacity", "column", "row"]
    },
    {
        "chart": "group_bar",
        "mark": "bar",
        "channels": ["x", "y", "color", "opacity", "column", "row"]
    },
    {
        "chart": "stacked_bar",
        "mark": "bar",
        "channels": ["x", "y", "color", "column", "row"]
    },
    {
        "chart": "heatmap",
        "mark": "rect",
        "channels": ["x", "y", "color", "column", "row"]
    },
    {
        "chart": "area",
        "mark": "area",
        "channels": ["x", "y", "color", "column", "row"]
    },
    {
        "chart": "streamgraph",
        "mark": "area",
        "channels": ["x", "y", "color", "column", "row"]
    },
    {
        "chart": "boxplot",
        "mark": "boxplot",
        "channels": ["x", "y", "color", "opacity", "column", "row"]
    },
    {
        "chart": "histogram",
        "mark": "bar",
        "channels": ["x", "color", "column", "row"]
    },
    {
        "chart": "pie",
        "mark": "arc",
        "channels": ["theta", "color", "column", "row"]
    },
    {
        "chart": "lollipop",
        "mark": "rule",  # layered: rule + circle
        "channels": ["x", "y", "color", "column", "row"]
    },
    {
        "chart": "strip",
        "mark": {"type": "circle", "opacity": 0.7},
        "channels": ["x", "y", "color", "size", "column", "row"]
    },
    {
        "chart": "density",
        "mark": "area",
        "channels": ["x", "color", "column", "row"]
    },
    {
        "chart": "bump",
        "mark": {"type": "line", "point": True, "interpolate": "monotone", "strokeWidth": 2},
        "channels": ["x", "y", "color", "detail", "column", "row"]
    },
    {
        "chart": "linear_regression",
        "mark": "circle",  # layered: circle + regression line
        "channels": ["x", "y", "size", "color", "column", "row"]
    },
    {
        "chart": "ranged_dot",
        "mark": "point",  # layered: line + point
        "channels": ["x", "y", "color"]
    },
    {
        "chart": "candlestick",
        "mark": "rule",  # layered: rule + bar
        "channels": ["x", "open", "high", "low", "close", "column", "row"]
    },
    {
        "chart": "waterfall",
        "mark": "bar",
        "channels": ["x", "y", "color", "column", "row"]
    },
    {
        "chart": "radar",
        "mark": "line",  # computed polar projection
        "channels": ["x", "y", "color", "column", "row"]
    },
    {
        "chart": "rose",
        "mark": {"type": "arc", "stroke": "white", "padAngle": 0.02},
        "channels": ["x", "y", "color", "column", "row"]
    },
    {
        "chart": "pyramid",
        "mark": "bar",  # hconcat of 2 panels
        "channels": ["x", "y", "color"]
    },
    {
        "chart": "worldmap",
        "mark": "circle",
        "channels": ["longitude", "latitude", "color", "size", "opacity"]
    },
    {
        "chart": "usmap",
        "mark": "circle",
        "channels": ["longitude", "latitude", "color", "size"]
    }
]


# Chart-type-aware expected types per (chart_type, channel).
# When detect_field_type disagrees with what the chart semantics require,
# the value here wins.  None means "keep detected".
_CHANNEL_TYPE_OVERRIDES: dict[str, dict[str, str]] = {
    "histogram":  {"x": "quantitative"},
    "heatmap":    {"x": "nominal", "y": "nominal"},
    "boxplot":    {"x": "nominal", "y": "quantitative"},
    "pie":        {"theta": "quantitative", "color": "nominal"},
    "worldmap":   {"longitude": "quantitative", "latitude": "quantitative"},
    "usmap":      {"longitude": "quantitative", "latitude": "quantitative"},
    "candlestick": {"x": "ordinal"},
    "density":    {"x": "quantitative"},
    "waterfall":  {"x": "ordinal", "y": "quantitative"},
    "pyramid":    {"y": "nominal", "x": "quantitative"},
    "strip":      {},  # detected dynamically
    "rose":       {"x": "nominal", "y": "quantitative"},
}

# Chart types where temporal fields on position channels should be ordinal
# (discrete bars/cells rather than a continuous time axis).
# For these charts, coerce_field_type downgrades "temporal" → "ordinal" on x/y.
_BAR_LIKE_CHARTS = {"bar", "group_bar", "stacked_bar", "lollipop", "waterfall"}


def coerce_field_type(chart_type: str, channel: str, detected_type: str) -> str:
    """
    Return the Vega-Lite type that should actually be used for this
    (chart_type, channel) combination.  If no override is needed the
    originally detected type is returned unchanged.
    """
    overrides = _CHANNEL_TYPE_OVERRIDES.get(chart_type, {})
    forced = overrides.get(channel)
    if forced:
        return forced

    # Bar-like charts: temporal on x/y should become ordinal (discrete bars)
    if chart_type in _BAR_LIKE_CHARTS and channel in ("x", "y") and detected_type == "temporal":
        return "ordinal"

    return detected_type


def get_chart_template(chart_type: str) -> dict | None:
    """
    Find a chart template by chart type name.
    """
    for template in CHART_TEMPLATES:
        if template["chart"] == chart_type:
            return template
    return None

def create_chart_spec(df: pd.DataFrame, fields: list[str], chart_type: str) -> dict[str, dict[str, str]]:
    """
    Assign fields to appropriate visualization channels based on their data types and chart type.
    """
    encodings = fields_to_encodings(df, chart_type, fields)
    return assemble_vegailte_chart(df, chart_type, encodings)


def fields_to_encodings(df, chart_type: str, fields: list[str]) -> dict[str, dict[str, str]]:
    """
    Assign fields to appropriate visualization channels based on their data types and chart type.
    
    Parameters:
    - df: pandas DataFrame containing the data
    - chart_type: string matching one of the chart types in CHART_TEMPLATES
    - fields: list of column names to assign to channels
    
    Returns:
    - dict: mapping of channel names to encoding objects with "field" and "type" properties ("nominal", "quantitative", "temporal")
    """
    if not fields:
        return {}
    
    # Get available channels for this chart type
    template = get_chart_template(chart_type)
    if not template:
        return {}
    
    available_channels = template["channels"]
    
    # Analyze field types and properties
    field_info = []
    for field in fields:
        if field not in df.columns:
            continue
            
        field_type = detect_field_type(df[field])
        cardinality = df[field].nunique()
        
        field_info.append({
            "field": field,
            "type": field_type,
            "cardinality": cardinality,
            "is_low_cardinality": cardinality <= 20,
            "is_very_low_cardinality": cardinality <= 10
        })
    
    if not field_info:
        return {}
    
    # Sort fields by priority for assignment
    def field_priority(field_info_item):
        # Prioritize temporal fields for time-based charts
        if chart_type in ["line", "area"] and field_info_item["type"] == "temporal":
            return 0
        # Prioritize quantitative fields
        elif field_info_item["type"] == "quantitative":
            return 1
        # Then categorical with reasonable cardinality
        elif field_info_item["is_low_cardinality"]:
            return 2
        # Finally high cardinality categoricals
        else:
            return 3
    
    field_info.sort(key=field_priority)
    
    encodings = {}
    used_fields = set()
    
    def get_field_info_by_name(field_name: str):
        """Helper to get field info by field name"""
        return next((f for f in field_info if f["field"] == field_name), None)
    
    def add_encoding(channel: str, field_name: str):
        """Add encoding with type conversion if necessary"""
        field_info_item = get_field_info_by_name(field_name)
        if not field_info_item:
            return
            
        original_type = field_info_item["type"]
        encoding = {"field": field_name}
        
        # Determine if type conversion is needed
        needs_conversion = False
        target_type = original_type
        
        # Heatmap axes should be categorical
        if chart_type == "heatmap" and channel in ["x", "y"]:
            if original_type in ["quantitative", "temporal"]:
                needs_conversion = True
                target_type = "nominal"
        
        # Bar chart x-axis should be categorical for grouping
        elif chart_type == "bar" and channel == "x":
            if original_type == "quantitative":
                needs_conversion = True
                target_type = "nominal"
        
        # Color channel in non-heatmap charts should be categorical for discrete colors
        elif channel == "color" and chart_type != "heatmap":
            if original_type == "quantitative" and field_info_item["is_low_cardinality"]:
                needs_conversion = True
                target_type = "nominal"
        
        # Faceting channels should be categorical
        elif channel in ["column", "row"]:
            if original_type in ["quantitative", "temporal"]:
                needs_conversion = True
                target_type = "nominal"
        
        # Shape channel should always be categorical
        elif channel == "shape":
            if original_type in ["quantitative", "temporal"]:
                needs_conversion = True
                target_type = "nominal"
        
        # Add type to encoding only if conversion is necessary
        if needs_conversion:
            encoding["type"] = target_type
            
        encodings[channel] = encoding
        used_fields.add(field_name)
    
    # Define channel assignment rules by chart type
    def assign_primary_channels():
        """Assign the main x and y channels"""
        if "x" in available_channels and "y" in available_channels:
            if chart_type == "bar":
                # Bar chart: x = categorical, y = quantitative
                categorical_field = next((f for f in field_info 
                                        if f["field"] not in used_fields and 
                                        f["type"] in ["nominal", "ordinal"]), None)
                any_available_field = next((f for f in field_info 
                                          if f["field"] not in used_fields and 
                                          f["type"] in ["quantitative", "temporal"]), None)
                
                if categorical_field:
                    add_encoding("x", categorical_field["field"])
                elif any_available_field:
                    add_encoding("x", any_available_field["field"])

                quantitative_field = next((f for f in field_info 
                                         if f["field"] not in used_fields and 
                                         f["type"] == "quantitative"), None)
                if quantitative_field:
                    add_encoding("y", quantitative_field["field"])
            
            elif chart_type in ["line", "area"]:
                # Line/Area chart: x = temporal/ordinal, y = quantitative
                temporal_field = next((f for f in field_info 
                                     if f["field"] not in used_fields and 
                                     f["type"] in ["temporal", "ordinal"]), None)
                # Fallback: use first available field of any type
                any_available_field = next((f for f in field_info 
                                          if f["field"] not in used_fields), None)
            
                if temporal_field:
                    add_encoding("x", temporal_field["field"])
                elif any_available_field:
                    add_encoding("x", any_available_field["field"])
                
                # Re-evaluate quantitative field after x-axis assignment
                quantitative_field = next((f for f in field_info 
                                         if f["field"] not in used_fields and 
                                         f["type"] == "quantitative"), None)
                if quantitative_field:
                    add_encoding("y", quantitative_field["field"])
            
            elif chart_type == "point":
                # Point charts: flexible for scatter plots, bubble charts, etc.
                # Prefer quantitative fields but accept any field type
                available_fields = [f for f in field_info if f["field"] not in used_fields]
                
                # Try to get quantitative fields first for traditional scatter plot
                quant_fields = [f for f in available_fields if f["type"] == "quantitative"]
                
                if len(quant_fields) >= 2:
                    # Traditional scatter plot with two quantitative axes
                    add_encoding("x", quant_fields[0]["field"])
                    add_encoding("y", quant_fields[1]["field"])
                elif len(available_fields) >= 2:
                    # Bubble chart or categorical point plot - use any available fields
                    add_encoding("x", available_fields[0]["field"])
                    add_encoding("y", available_fields[1]["field"])
                elif len(available_fields) == 1:
                    # Single field - use for y-axis, x can be index or categorical
                    add_encoding("y", available_fields[0]["field"])
            
            elif chart_type == "heatmap":
                # Heatmap: x = categorical, y = categorical, color = quantitative
                categorical_fields = [f for f in field_info 
                                    if f["field"] not in used_fields and 
                                    f["type"] in ["nominal", "ordinal"]]
                
                # Assign x and y to categorical fields
                if len(categorical_fields) >= 2:
                    add_encoding("x", categorical_fields[0]["field"])
                    add_encoding("y", categorical_fields[1]["field"])
                elif len(categorical_fields) >= 1:
                    # Use available categorical field for one axis
                    add_encoding("x", categorical_fields[0]["field"])
                    
                    # Try to find another field for y-axis
                    other_field = next((f for f in field_info 
                                      if f["field"] not in used_fields), None)
                    if other_field:
                        add_encoding("y", other_field["field"])
                else:
                    # Fallback: use any available fields
                    available_fields = [f for f in field_info if f["field"] not in used_fields]
                    if len(available_fields) >= 2:
                        add_encoding("x", available_fields[0]["field"])
                        add_encoding("y", available_fields[1]["field"])
            
            elif chart_type == "boxplot":
                # Box plot: x = categorical, y = quantitative
                categorical_field = next((f for f in field_info 
                                        if f["field"] not in used_fields and 
                                        f["type"] in ["nominal", "ordinal"]), None)
                quantitative_field = next((f for f in field_info 
                                         if f["field"] not in used_fields and 
                                         f["type"] == "quantitative"), None)
                
                if categorical_field:
                    add_encoding("x", categorical_field["field"])
                
                if quantitative_field:
                    add_encoding("y", quantitative_field["field"])
            
            else:
                # Default: assign first two available fields
                available_fields = [f for f in field_info if f["field"] not in used_fields]
                if len(available_fields) >= 1:
                    add_encoding("x", available_fields[0]["field"])
                if len(available_fields) >= 2:
                    add_encoding("y", available_fields[1]["field"])
    
    def assign_aesthetic_channels():
        """Assign color, size, shape channels"""
        remaining_fields = [f for f in field_info if f["field"] not in used_fields]
        
        # Special handling for heatmap color channel
        if chart_type == "heatmap" and "color" in available_channels and remaining_fields:
            # For heatmaps, color should be quantitative for intensity
            color_field = next((f for f in remaining_fields 
                              if f["type"] == "quantitative"), None)
            if not color_field:
                # Fallback to any remaining field
                color_field = remaining_fields[0]
            
            add_encoding("color", color_field["field"])
            remaining_fields = [f for f in remaining_fields if f["field"] != color_field["field"]]
        
        # Color for other chart types: prefer low cardinality categorical fields
        elif "color" in available_channels and remaining_fields:
            color_field = next((f for f in remaining_fields 
                              if f["is_low_cardinality"] and 
                              f["type"] in ["nominal", "ordinal"]), None)
            if not color_field:
                color_field = remaining_fields[0]
            
            add_encoding("color", color_field["field"])
            remaining_fields = [f for f in remaining_fields if f["field"] != color_field["field"]]
        
        # Size: prefer quantitative fields (great for bubble charts)
        if "size" in available_channels and remaining_fields:
            size_field = next((f for f in remaining_fields 
                             if f["type"] == "quantitative"), None)
            if size_field:
                add_encoding("size", size_field["field"])
                remaining_fields = [f for f in remaining_fields if f["field"] != size_field["field"]]
        
        # Shape: prefer very low cardinality categorical fields
        if "shape" in available_channels and remaining_fields:
            shape_field = next((f for f in remaining_fields 
                              if f["is_very_low_cardinality"] and 
                              f["type"] in ["nominal", "ordinal"]), None)
            if shape_field:
                add_encoding("shape", shape_field["field"])
                remaining_fields = [f for f in remaining_fields if f["field"] != shape_field["field"]]
    
    def assign_faceting_channels():
        """Assign column and row channels for faceting"""
        remaining_fields = [f for f in field_info if f["field"] not in used_fields]
        
        # Column: prefer low cardinality fields
        if "column" in available_channels and remaining_fields:
            col_field = next((f for f in remaining_fields 
                            if f["is_low_cardinality"]), None)
            if col_field:
                add_encoding("column", col_field["field"])
                remaining_fields = [f for f in remaining_fields if f["field"] != col_field["field"]]
        
        # Row: prefer very low cardinality fields (fewer rows than columns)
        if "row" in available_channels and remaining_fields:
            row_field = next((f for f in remaining_fields 
                            if f["is_very_low_cardinality"]), None)
            if row_field:
                add_encoding("row", row_field["field"])
    
    # Execute assignment strategy
    assign_primary_channels()
    assign_aesthetic_channels()
    assign_faceting_channels()
    
    return encodings


def assemble_vegailte_chart(
    df: pd.DataFrame, 
    chart_type: str, 
    encodings: dict[str, dict[str, str]],
    max_nominal_values: int = 68,
    config: dict | None = None,
    semantic_types: dict[str, Any] | None = None,
) -> dict:
    """
    Assemble a Vega-Lite chart specification from a dataframe, chart type, and encodings.
    
    Parameters:
    - df: pandas DataFrame containing the data
    - chart_type: string matching one of the chart types in CHART_TEMPLATES
    - encodings: dict mapping channel names to encoding objects with "field" property
      Examples:
      - Simple: {"x": {"field": "field1"}, "y": {"field": "field2"}}
      - With aggregation: {"x": {"field": "category"}, "y": {"field": "sales", "aggregate": "mean"}}
    - max_nominal_values: maximum number of values for nominal axes before truncating
    - config: optional chart configuration (binCount, innerRadius, colorScheme, etc.)
    - semantic_types: optional dict mapping field names to semantic type strings or
      annotation dicts {"type": "Revenue", "unit": "USD", "intrinsic_domain": [0, 100]}
    
    Returns:
    - dict: Vega-Lite specification
    """
    semantic_types = semantic_types or {}
    # Find the chart template
    template = get_chart_template(chart_type)
    if not template:
        raise ValueError(f"Chart type '{chart_type}' not found in templates")
    
    # Build initial spec — some chart types need special structure
    spec = _build_initial_spec(chart_type, template, df, encodings, config)
    
    # Remove duplicate columns before converting to records
    if df.columns.duplicated().any():
        df = df.loc[:, ~df.columns.duplicated()]
    # Add data to the spec (inline data from dataframe)
    table_data = df.to_dict('records')
    
    # Resolve mark type for semantic decisions
    mark_type = template["mark"]
    if isinstance(mark_type, dict):
        mark_type = mark_type.get("type", "point")

    # Chart types that self-manage their encodings in _post_process_chart.
    # For these, we still resolve field types but skip adding to spec encoding
    # (the _post_process function distributes them from the raw encodings dict).
    _SELF_MANAGED_CHARTS = {"radar", "pyramid", "waterfall"}
    # Density: x/y are pre-set by template; only color goes through normal path
    _DENSITY_SKIP_CHANNELS = {"x", "y"} if chart_type == "density" else set()

    # Apply encodings with semantic-aware handling
    for channel, encoding_input in encodings.items():
        # Parse encoding input (always a dict with "field" property)
        field_name = encoding_input.get("field")
        aggregate_func = encoding_input.get("aggregate")
        
        if not field_name or field_name not in df.columns:
            continue
            
        encoding_obj = {}
        cs: ChannelSemantics | None = None  # channel semantics (when available)
        
        # Special scale configuration for radius
        if channel == "radius":
            encoding_obj["scale"] = {"type": "sqrt", "zero": True}
        
        # Handle aggregation
        if aggregate_func == "count":
            encoding_obj["field"] = "*"
            encoding_obj["aggregate"] = "count"
            encoding_obj["title"] = "Count"
            encoding_obj["type"] = "quantitative"
        elif aggregate_func:
            encoding_obj["field"] = field_name
            encoding_obj["aggregate"] = aggregate_func
            encoding_obj["type"] = "quantitative"
        else:
            # --- Resolve field type and semantics ---
            field_values = df[field_name].dropna().tolist()
            sem_annotation = semantic_types.get(field_name)
            
            # Extract semantic type string and optional metadata
            sem_type = ''
            sem_unit = None
            sem_domain = None
            if isinstance(sem_annotation, str):
                sem_type = sem_annotation
            elif isinstance(sem_annotation, dict):
                sem_type = sem_annotation.get('type', sem_annotation.get('semantic_type', ''))
                sem_unit = sem_annotation.get('unit')
                raw_domain = sem_annotation.get('intrinsic_domain')
                if isinstance(raw_domain, (list, tuple)) and len(raw_domain) == 2:
                    sem_domain = (raw_domain[0], raw_domain[1])
            
            # Use semantic-aware type resolution when available, else fall back
            if sem_type and is_registered(sem_type):
                cs = resolve_channel_semantics(
                    field_name, sem_type, channel, mark_type,
                    field_values, unit=sem_unit, intrinsic_domain=sem_domain,
                )
                encoding_obj["field"] = field_name
                encoding_obj["type"] = cs.vl_type
            else:
                field_type = resolve_field_type(df[field_name], field_name)
                encoding_obj["field"] = field_name
                encoding_obj["type"] = field_type
            
            # Special handling for year/date fields
            if pd.api.types.is_datetime64_any_dtype(df[field_name]):
                if channel in ['color', 'size', 'column', 'row']:
                    encoding_obj["type"] = "nominal"
                else:
                    encoding_obj["type"] = "temporal"
            
            # Chart-type-aware type coercion (e.g. histogram x must be quantitative,
            # bar x must be nominal, heatmap x/y must be nominal, etc.)
            encoding_obj["type"] = coerce_field_type(chart_type, channel, encoding_obj["type"])
        
        # ── Apply semantic enhancements when available ─────────────────────
        if cs:
            _apply_semantic_encoding(encoding_obj, cs, channel, chart_type, config)
        else:
            # Legacy fallback: basic color handling
            if encoding_obj.get("type") == "nominal" and channel == "color":
                unique_values = df[field_name].unique()
                if len(unique_values) >= 16:
                    encoding_obj["scale"] = {"scheme": "tableau20"}
                    encoding_obj["legend"] = {"symbolSize": 12, "labelFontSize": 8}
        
        # For map charts, encodings go into the second layer
        if chart_type in ("worldmap", "usmap"):
            spec["layer"][1]["encoding"][channel] = encoding_obj
        elif chart_type in _SELF_MANAGED_CHARTS:
            pass  # post_process will handle distribution from raw encodings
        elif channel in _DENSITY_SKIP_CHANNELS:
            pass  # density template pre-sets x/y
        else:
            # Add encoding to spec
            spec.setdefault("encoding", {})[channel] = encoding_obj
    
    # Special handling for histogram: ensure x has bin:true and y has count
    if chart_type == "histogram":
        if "x" in spec["encoding"]:
            spec["encoding"]["x"]["bin"] = True
        if "y" not in spec["encoding"]:
            spec["encoding"]["y"] = {"aggregate": "count"}
    
    # Special handling for pie: mark is 'arc'
    if chart_type == "pie":
        spec["mark"] = "arc"
    
    # Special handling for group_bar: add xOffset using the same field as color
    if chart_type == "group_bar" and "color" in spec.get("encoding", {}):
        color_encoding = spec["encoding"]["color"]
        spec["encoding"]["xOffset"] = {
            "field": color_encoding["field"],
            "type": color_encoding.get("type", "nominal")
        }

    # Special handling for stacked_bar: set stack mode on quant axis
    if chart_type == "stacked_bar":
        stack_mode = (config or {}).get("stackMode", "stacked")
        for axis in ("y", "x"):
            enc = spec.get("encoding", {}).get(axis)
            if enc and enc.get("type") == "quantitative":
                if stack_mode == "normalize":
                    enc["stack"] = "normalize"
                elif stack_mode == "center":
                    enc["stack"] = "center"
                elif stack_mode == "layered":
                    enc["stack"] = None
                # default "stacked" uses VL default (true)
                break

    # Post-process special chart types (layered specs handled by _build_initial_spec)
    _post_process_chart(spec, chart_type, df, encodings, config)
    
    # Apply config options
    if config:
        _apply_chart_config(spec, chart_type, config)
    
    # Handle agent "facet" channel → map to "column" so the existing column→facet logic picks it up
    enc_target = spec["layer"][1]["encoding"] if chart_type in ("worldmap", "usmap") else spec.get("encoding", {})
    if "facet" in enc_target and "column" not in enc_target:
        enc_target["column"] = enc_target.pop("facet")
    
    # Handle faceting (column without row becomes facet)
    if "encoding" in spec:
        if "column" in spec["encoding"] and "row" not in spec["encoding"]:
            spec["encoding"]["facet"] = spec["encoding"]["column"]
            spec["encoding"]["facet"]["columns"] = 6
            del spec["encoding"]["column"]
    
    # Handle nominal axes with many entries
    spec_encoding = spec.get("encoding", {})
    for channel in ['x', 'y', 'column', 'row']:
        if channel in spec_encoding:
            encoding = spec_encoding[channel]
            if encoding.get("type") == "nominal":
                field_name = encoding["field"]
                unique_values = df[field_name].unique()
                
                if len(unique_values) > max_nominal_values:
                    values_to_keep = _get_top_values(
                        df, field_name, unique_values, channel, spec, max_nominal_values
                    )
                    
                    # Filter the data
                    table_data = [
                        row for row in table_data 
                        if row[field_name] in values_to_keep
                    ]
                    
                    # Add placeholder for omitted values
                    omitted_count = len(unique_values) - len(values_to_keep)
                    placeholder = f"...{omitted_count} items omitted"
                    
                    # Update domain
                    encoding["scale"] = encoding.get("scale", {})
                    encoding["scale"]["domain"] = list(values_to_keep) + [placeholder]
                    
                    # Style the placeholder
                    encoding["axis"] = encoding.get("axis", {})
                    encoding["axis"]["labelColor"] = {
                        "condition": {
                            "test": f"datum.label == '{placeholder}'",
                            "value": "#999999"
                        },
                        "value": "#000000"
                    }
    
    # Apply spec quality improvements (null handling, tooltips, sizing, etc.)
    table_data = _apply_spec_quality(spec, table_data, df, chart_type)

    # Convert temporal fields to strings for Vega-Lite.
    # Uses the robust convert_temporal_data which handles datetime objects,
    # timestamps, year integers, date strings, etc.
    table_data = convert_temporal_data(table_data, semantic_types)

    # Post-encoding temporal guard: any field resolved as type="temporal"
    # must have its integer values converted to strings so VL doesn't
    # interpret e.g. 2024 as 2024ms-since-epoch.  convert_temporal_data
    # above handles fields with known semantic types, but fields resolved
    # as temporal purely by name heuristic (e.g. column named "year")
    # may still have raw integer values.
    _temporal_fields = set()
    for _enc in spec.get("encoding", {}).values():
        if isinstance(_enc, dict) and _enc.get("type") == "temporal":
            _f = _enc.get("field")
            if _f:
                _temporal_fields.add(_f)
    if _temporal_fields and table_data:
        for row in table_data:
            for _f in _temporal_fields:
                v = row.get(_f)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    row[_f] = str(int(v)) if v == int(v) else str(v)

    # Charts that manage their own data (waterfall, radar, pyramid) set
    # spec["data"] in _post_process_chart — don't overwrite it.
    if "data" not in spec:
        spec["data"] = {"values": table_data}
    return spec


# ---------------------------------------------------------------------------
# _build_initial_spec — construct the initial VL spec skeleton for each type
# ---------------------------------------------------------------------------

def _build_initial_spec(
    chart_type: str,
    template: dict,
    df: pd.DataFrame,
    encodings: dict,
    config: dict | None,
) -> dict:
    """Build the initial VL spec skeleton before encoding channels are applied."""

    if chart_type == "histogram":
        return {
            "mark": "bar",
            "encoding": {
                "x": {"bin": True},
                "y": {"aggregate": "count"},
            },
        }

    if chart_type in ("worldmap", "usmap"):
        projection_type = "albersUsa" if chart_type == "usmap" else "equalEarth"
        topo_url = (
            "https://vega.github.io/vega-lite/data/us-10m.json"
            if chart_type == "usmap"
            else "https://vega.github.io/vega-lite/data/world-110m.json"
        )
        topo_feature = "states" if chart_type == "usmap" else "countries"
        return {
            "width": 500 if chart_type == "usmap" else 600,
            "height": 300 if chart_type == "usmap" else 350,
            "layer": [
                {
                    "data": {"url": topo_url, "format": {"type": "topojson", "feature": topo_feature}},
                    "projection": {"type": projection_type},
                    "mark": {"type": "geoshape", "fill": "lightgray", "stroke": "white"},
                },
                {
                    "projection": {"type": projection_type},
                    "mark": "circle",
                    "encoding": {},
                },
            ],
        }

    if chart_type == "lollipop":
        return {
            "encoding": {},
            "layer": [
                {"mark": {"type": "rule", "strokeWidth": 1.5}, "encoding": {}},
                {"mark": {"type": "circle", "size": int((config or {}).get("dotSize", 80))}, "encoding": {}},
            ],
        }

    if chart_type == "linear_regression":
        return {
            "layer": [
                {"mark": "circle", "encoding": {}},
                {
                    "mark": {"type": "line", "color": "red"},
                    "transform": [{"regression": "__y__", "on": "__x__"}],
                    "encoding": {},
                },
            ],
            "encoding": {},
        }

    if chart_type == "ranged_dot":
        return {
            "encoding": {},
            "layer": [
                {"mark": "line", "encoding": {"detail": {}}},
                {"mark": {"type": "point", "filled": True}, "encoding": {"color": {}}},
            ],
        }

    if chart_type == "candlestick":
        return {
            "encoding": {},
            "layer": [
                {"mark": "rule", "encoding": {}},
                {"mark": {"type": "bar", "size": 14}, "encoding": {}},
            ],
        }

    if chart_type == "waterfall":
        # Will be rebuilt into layered spec in _post_process_chart
        return {"mark": "bar", "encoding": {}}

    if chart_type == "density":
        return {
            "mark": "area",
            "transform": [{"density": "__field__"}],
            "encoding": {
                "x": {"field": "value", "type": "quantitative"},
                "y": {"field": "density", "type": "quantitative"},
            },
        }

    if chart_type == "radar":
        # Radar is entirely computed; placeholder spec
        return {"mark": "point", "encoding": {}}

    if chart_type == "pyramid":
        return {
            "spacing": 0,
            "resolve": {"scale": {"y": "shared"}},
            "hconcat": [
                {
                    "mark": "bar",
                    "encoding": {
                        "y": {},
                        "x": {"scale": {"reverse": True}, "stack": None},
                        "opacity": {"value": 0.9},
                        "color": {"value": "#4e79a7"},
                    },
                },
                {
                    "mark": "bar",
                    "encoding": {
                        "y": {"axis": None},
                        "x": {"stack": None},
                        "opacity": {"value": 0.9},
                        "color": {"value": "#e15759"},
                    },
                },
            ],
            "config": {"view": {"stroke": None}, "axis": {"grid": False}},
        }

    if chart_type == "streamgraph":
        return {"mark": "area", "encoding": {}}

    if chart_type == "rose":
        mark = {"type": "arc", "stroke": "white", "padAngle": 0.02}
        return {"mark": mark, "encoding": {}}

    # Default: use template mark
    mark = template["mark"]
    return {"mark": mark, "encoding": {}}


# ---------------------------------------------------------------------------
# _post_process_chart — chart-type-specific post-processing
# ---------------------------------------------------------------------------

def _post_process_chart(
    spec: dict,
    chart_type: str,
    df: pd.DataFrame,
    encodings: dict,
    config: dict | None,
) -> None:
    """Apply chart-type-specific post-processing after encodings are set."""

    if chart_type == "lollipop":
        _post_process_lollipop(spec, df, encodings)

    elif chart_type == "linear_regression":
        _post_process_linear_regression(spec, encodings)

    elif chart_type == "ranged_dot":
        _post_process_ranged_dot(spec, encodings)

    elif chart_type == "candlestick":
        _post_process_candlestick(spec, df, encodings, config)

    elif chart_type == "waterfall":
        _post_process_waterfall(spec, df, encodings, config)

    elif chart_type == "density":
        _post_process_density(spec, encodings, config)

    elif chart_type == "radar":
        _post_process_radar(spec, df, encodings, config)

    elif chart_type == "pyramid":
        _post_process_pyramid(spec, df, encodings)

    elif chart_type == "streamgraph":
        _post_process_streamgraph(spec, encodings, config)

    elif chart_type == "bump":
        _post_process_bump(spec, encodings)

    elif chart_type == "strip":
        _post_process_strip(spec, df, encodings, config)

    elif chart_type == "rose":
        _post_process_rose(spec, df, encodings, config)


def _post_process_lollipop(spec: dict, df: pd.DataFrame, encodings: dict) -> None:
    """Lollipop: rule from 0 + circle at value. Both layers share positional encodings."""
    enc = spec.get("encoding", {})
    layer_rule = spec["layer"][0]
    layer_circle = spec["layer"][1]

    for ch in ("x", "y"):
        if ch in enc:
            layer_rule["encoding"][ch] = dict(enc[ch])
            layer_circle["encoding"][ch] = dict(enc[ch])

    # Anchor rule from 0 on the quantitative axis
    for axis in ("y", "x"):
        if enc.get(axis, {}).get("type") == "quantitative":
            layer_rule["encoding"][f"{axis}2"] = {"datum": 0}
            break

    # Color → circle layer only
    if "color" in enc:
        layer_circle["encoding"]["color"] = enc.pop("color")

    # Facets stay at top-level
    for ch in list(enc.keys()):
        if ch not in ("x", "y"):
            pass  # keep in top encoding for faceting


def _post_process_linear_regression(spec: dict, encodings: dict) -> None:
    """Linear regression: scatter layer + regression trend line."""
    scatter = spec["layer"][0]
    regression = spec["layer"][1]
    top_enc = spec.get("encoding", {})

    x_enc = top_enc.get("x")
    y_enc = top_enc.get("y")

    if x_enc:
        scatter["encoding"]["x"] = dict(x_enc)
        regression["encoding"]["x"] = dict(x_enc)
        regression["transform"][0]["on"] = x_enc.get("field", "__x__")
    if y_enc:
        scatter["encoding"]["y"] = dict(y_enc)
        regression["encoding"]["y"] = dict(y_enc)
        regression["transform"][0]["regression"] = y_enc.get("field", "__y__")

    if "color" in top_enc:
        scatter["encoding"]["color"] = top_enc.pop("color")
    if "size" in top_enc:
        scatter["encoding"]["size"] = top_enc.pop("size")

    # Facets
    for ch in ("column", "row"):
        if ch in top_enc:
            pass  # keep at top level


def _post_process_ranged_dot(spec: dict, encodings: dict) -> None:
    """Ranged dot plot: line + point layers; detail links line segments."""
    enc = spec.get("encoding", {})
    line_layer = spec["layer"][0]
    point_layer = spec["layer"][1]

    if "color" in enc:
        point_layer["encoding"]["color"] = enc.pop("color")

    # Copy nominal axis into detail encoding for line layer
    if enc.get("y", {}).get("type") == "nominal":
        import copy
        line_layer["encoding"]["detail"] = copy.deepcopy(enc["y"])
    elif enc.get("x", {}).get("type") == "nominal":
        import copy
        line_layer["encoding"]["detail"] = copy.deepcopy(enc["x"])


def _post_process_candlestick(
    spec: dict, df: pd.DataFrame, encodings: dict, config: dict | None
) -> None:
    """Candlestick: rule (wick) + bar (body) with conditional coloring."""
    enc = spec.get("encoding", {})
    rule = spec["layer"][0]
    bar = spec["layer"][1]

    # x shared
    if "x" in enc:
        x_enc = dict(enc["x"])
        if x_enc.get("type") in ("nominal", "ordinal"):
            x_enc["sort"] = None
        spec["encoding"]["x"] = x_enc

    # Shared y-axis
    y_axis = {"type": "quantitative", "scale": {"zero": False}, "axis": {"title": None}}
    spec["title"] = {"text": "Price", "anchor": "start", "fontSize": 11,
                      "fontWeight": "normal", "color": "#666"}

    # Rule: y = low, y2 = high
    open_f = encodings.get("open", {}).get("field")
    high_f = encodings.get("high", {}).get("field")
    low_f  = encodings.get("low", {}).get("field")
    close_f = encodings.get("close", {}).get("field")

    if low_f and high_f:
        rule["encoding"]["y"] = {"field": low_f, **y_axis}
        rule["encoding"]["y2"] = {"field": high_f}
    if open_f and close_f:
        bar["encoding"]["y"] = {"field": open_f, **y_axis}
        bar["encoding"]["y2"] = {"field": close_f}
        # Conditional color: green up, red down
        bar["encoding"]["color"] = {
            "condition": {
                "test": f"datum['{open_f}'] < datum['{close_f}']",
                "value": "#06982d",
            },
            "value": "#ae1325",
        }

    # Adaptive bar size
    x_field = enc.get("x", {}).get("field")
    if x_field and x_field in df.columns:
        card = df[x_field].nunique()
        plot_w = 400
        bar_size = max(2, min(20, round(plot_w * 0.6 / max(card, 1))))
        bar["mark"]["size"] = bar_size

    # Remove OHLC channels from top-level encoding (not VL channels)
    for ch in ("open", "high", "low", "close"):
        enc.pop(ch, None)


def _post_process_waterfall(
    spec: dict, df: pd.DataFrame, encodings: dict, config: dict | None
) -> None:
    """Waterfall: cumulative bar chart with positive/negative coloring."""
    x_field = encodings.get("x", {}).get("field")
    y_field = encodings.get("y", {}).get("field")
    if not x_field or not y_field or x_field not in df.columns or y_field not in df.columns:
        return

    # Build cumulative waterfall data
    wf_data = []
    cumsum = 0
    rows = df[[x_field, y_field]].to_dict("records")
    total_rows = len(rows)
    for i, row in enumerate(rows):
        val = row[y_field] if isinstance(row[y_field], (int, float)) else 0
        prev = cumsum
        if i == 0 or i == total_rows - 1:
            wf_type = "total"
            cumsum = val
            prev = 0
        else:
            wf_type = "increase" if val >= 0 else "decrease"
            cumsum += val
        wf_data.append({
            x_field: row[x_field],
            "__wf_prev_sum": prev,
            "__wf_sum": cumsum,
            "__wf_color": wf_type,
        })

    corner_radius = int((config or {}).get("cornerRadius", 0))
    mark_obj: dict = {"type": "bar"}
    if corner_radius:
        mark_obj["cornerRadius"] = corner_radius

    spec.clear()
    spec.update({
        "data": {"values": wf_data},
        "encoding": {
            "x": {"field": x_field, "type": "ordinal", "sort": None,
                   "axis": {"labelAngle": -45}},
        },
        "layer": [
            {
                "mark": mark_obj,
                "encoding": {
                    "y": {"field": "__wf_prev_sum", "type": "quantitative", "title": y_field},
                    "y2": {"field": "__wf_sum"},
                    "color": {
                        "field": "__wf_color",
                        "type": "nominal",
                        "scale": {
                            "domain": ["total", "increase", "decrease"],
                            "range": ["#f7e0b6", "#93c4aa", "#f78a64"],
                        },
                        "legend": {"title": "Type"},
                    },
                },
            }
        ],
    })


def _post_process_density(spec: dict, encodings: dict, config: dict | None) -> None:
    """Density plot: kernel density transform."""
    x_enc = encodings.get("x", {})
    x_field = x_enc.get("field")
    if x_field:
        spec["transform"][0]["density"] = x_field
        spec["encoding"]["x"]["title"] = x_field

    color_enc = encodings.get("color", {})
    if color_enc.get("field"):
        spec["transform"][0]["groupby"] = [color_enc["field"]]
        spec["encoding"]["color"] = {
            "field": color_enc["field"],
            "type": color_enc.get("type", "nominal"),
        }

    bandwidth = (config or {}).get("bandwidth")
    if bandwidth and float(bandwidth) > 0:
        spec["transform"][0]["bandwidth"] = float(bandwidth)

    # Remove x/y from top-level encoding (already set by template)
    # Don't re-add them from the encoding loop


def _post_process_radar(
    spec: dict, df: pd.DataFrame, encodings: dict, config: dict | None
) -> None:
    """Radar chart: entirely client-computed polar projection."""
    x_enc = encodings.get("x", {})
    y_enc = encodings.get("y", {})
    color_enc = encodings.get("color", {})

    axis_field = x_enc.get("field")
    value_field = y_enc.get("field")
    group_field = color_enc.get("field")

    if not axis_field or not value_field:
        return
    if axis_field not in df.columns or value_field not in df.columns:
        return

    axes = df[axis_field].unique().tolist()
    n_axes = len(axes)
    if n_axes < 3:
        return

    groups = df[group_field].unique().tolist() if group_field and group_field in df.columns else ["__all__"]

    # Compute per-axis max for normalization
    axis_max = {}
    for ax in axes:
        vals = df[df[axis_field] == ax][value_field].dropna()
        mx = float(vals.max()) if len(vals) > 0 else 1
        axis_max[ax] = mx if mx > 0 else 1

    # Build polar coordinates
    import math as _math

    polygon_data = []
    point_data = []
    for grp in groups:
        subset = df if grp == "__all__" else df[df[group_field] == grp]
        for i, ax in enumerate(axes):
            angle = 2 * _math.pi * i / n_axes
            vals = subset[subset[axis_field] == ax][value_field].dropna()
            mean_val = float(vals.mean()) if len(vals) > 0 else 0
            norm = mean_val / axis_max[ax]
            px = norm * _math.sin(angle)
            py = -norm * _math.cos(angle)
            rec = {"__x": px, "__y": py, "__group": grp, "__angle": angle, "__axis": ax, "__value": mean_val}
            polygon_data.append(rec)
            point_data.append(rec)
        # Close polygon
        if n_axes > 0:
            first = polygon_data[-(n_axes)]
            polygon_data.append({**first})

    # Spoke data
    spoke_data = []
    for i, ax in enumerate(axes):
        angle = 2 * _math.pi * i / n_axes
        spoke_data.append({"__x": 0, "__y": 0, "__x2": _math.sin(angle), "__y2": -_math.cos(angle)})

    # Ring data (concentric polygons at 0.25, 0.5, 0.75, 1.0)
    ring_data = []
    for level in (0.25, 0.5, 0.75, 1.0):
        for i in range(n_axes + 1):
            angle = 2 * _math.pi * (i % n_axes) / n_axes
            ring_data.append({
                "__x": level * _math.sin(angle),
                "__y": -level * _math.cos(angle),
                "__level": level,
                "__order": i,
            })

    # Label data
    label_data = []
    for i, ax in enumerate(axes):
        angle = 2 * _math.pi * i / n_axes
        r = 1.12
        label_data.append({
            "__x": r * _math.sin(angle),
            "__y": -r * _math.cos(angle),
            "__label": f"{ax}\n({axis_max[ax]:.0f})",
            "__align": "center" if abs(_math.sin(angle)) < 0.01 else ("left" if _math.sin(angle) > 0 else "right"),
        })

    filled = (config or {}).get("filled", True)
    fill_opacity = float((config or {}).get("fillOpacity", 0.15))
    stroke_width = float((config or {}).get("strokeWidth", 1.5))

    scale_xy = {"domain": [-1.18, 1.18]}
    layers = [
        # Spokes
        {
            "data": {"values": spoke_data},
            "mark": {"type": "rule", "color": "#ddd"},
            "encoding": {
                "x": {"field": "__x", "type": "quantitative", "scale": scale_xy, "axis": None},
                "y": {"field": "__y", "type": "quantitative", "scale": scale_xy, "axis": None},
                "x2": {"field": "__x2"},
                "y2": {"field": "__y2"},
            },
        },
        # Rings
        {
            "data": {"values": ring_data},
            "mark": {"type": "line", "color": "#eee", "strokeWidth": 0.5},
            "encoding": {
                "x": {"field": "__x", "type": "quantitative", "scale": scale_xy, "axis": None},
                "y": {"field": "__y", "type": "quantitative", "scale": scale_xy, "axis": None},
                "detail": {"field": "__level", "type": "nominal"},
                "order": {"field": "__order", "type": "quantitative"},
            },
        },
        # Labels
        {
            "data": {"values": label_data},
            "mark": {"type": "text", "fontSize": 11},
            "encoding": {
                "x": {"field": "__x", "type": "quantitative", "scale": scale_xy, "axis": None},
                "y": {"field": "__y", "type": "quantitative", "scale": scale_xy, "axis": None},
                "text": {"field": "__label", "type": "nominal"},
                "align": {"field": "__align", "type": "nominal"},
            },
        },
        # Data polygon
        {
            "data": {"values": polygon_data},
            "mark": {
                "type": "line",
                "interpolate": "linear-closed",
                "strokeWidth": stroke_width,
                **({"filled": True, "fillOpacity": fill_opacity} if filled else {}),
            },
            "encoding": {
                "x": {"field": "__x", "type": "quantitative", "scale": scale_xy, "axis": None},
                "y": {"field": "__y", "type": "quantitative", "scale": scale_xy, "axis": None},
                "color": {"field": "__group", "type": "nominal"},
                "order": {"field": "__angle", "type": "quantitative"},
            },
        },
        # Data points
        {
            "data": {"values": point_data},
            "mark": {"type": "point", "filled": True, "size": 25},
            "encoding": {
                "x": {"field": "__x", "type": "quantitative", "scale": scale_xy, "axis": None},
                "y": {"field": "__y", "type": "quantitative", "scale": scale_xy, "axis": None},
                "color": {"field": "__group", "type": "nominal"},
            },
        },
    ]

    size = min(400, 400)
    spec.clear()
    spec.update({
        "width": size,
        "height": size,
        "layer": layers,
        "config": {"view": {"stroke": None}},
    })


def _post_process_pyramid(spec: dict, df: pd.DataFrame, encodings: dict) -> None:
    """Pyramid: hconcat of two mirrored bar panels split by color field."""
    if "hconcat" not in spec:
        return

    x_enc = encodings.get("x", {})
    y_enc = encodings.get("y", {})
    color_enc = encodings.get("color", {})

    y_field = y_enc.get("field") or x_enc.get("field")
    x_field = x_enc.get("field") if y_enc.get("field") else y_enc.get("field")
    group_field = color_enc.get("field")

    if not y_field or not x_field or not group_field:
        return
    if y_field not in df.columns or x_field not in df.columns or group_field not in df.columns:
        return

    groups = df[group_field].unique().tolist()
    left_group = groups[0] if len(groups) > 0 else None
    right_group = groups[1] if len(groups) > 1 else None

    table_data = df.to_dict("records")
    left_panel = spec["hconcat"][0]
    right_panel = spec["hconcat"][1]

    # y is the categorical axis (shared)
    left_panel["encoding"]["y"] = {"field": y_field, "type": "nominal", "sort": None}
    right_panel["encoding"]["y"] = {"field": y_field, "type": "nominal", "axis": None, "sort": None}

    # x is the quantitative axis
    x_max = float(df[x_field].max()) if pd.api.types.is_numeric_dtype(df[x_field]) else 100
    left_panel["encoding"]["x"] = {
        "field": x_field, "type": "quantitative",
        "scale": {"reverse": True, "domain": [0, x_max]},
        "stack": None,
    }
    right_panel["encoding"]["x"] = {
        "field": x_field, "type": "quantitative",
        "scale": {"domain": [0, x_max]},
        "stack": None,
    }

    # Filter each panel
    if left_group is not None:
        left_panel["transform"] = [{"filter": {"field": group_field, "equal": left_group}}]
        left_panel["encoding"]["color"] = {"value": "#4e79a7"}
    if right_group is not None:
        right_panel["transform"] = [{"filter": {"field": group_field, "equal": right_group}}]
        right_panel["encoding"]["color"] = {"value": "#e15759"}

    spec["data"] = {"values": table_data}


def _post_process_streamgraph(spec: dict, encodings: dict, config: dict | None) -> None:
    """Streamgraph: stacked area with center baseline."""
    enc = spec.get("encoding", {})
    # Force center stack on the quantitative axis
    for axis in ("y", "x"):
        if enc.get(axis, {}).get("type") == "quantitative":
            enc[axis]["stack"] = "center"
            enc[axis]["axis"] = None
            break

    interpolate = (config or {}).get("interpolate")
    if interpolate:
        spec["mark"] = {"type": "area", "interpolate": interpolate}


def _post_process_bump(spec: dict, encodings: dict) -> None:
    """Bump chart: reversed y-axis so rank 1 is at top."""
    enc = spec.get("encoding", {})
    # Detect rank axis (defaults to y)
    y_enc = enc.get("y", {})
    if y_enc:
        y_enc.setdefault("scale", {})["reverse"] = True


def _post_process_strip(
    spec: dict, df: pd.DataFrame, encodings: dict, config: dict | None
) -> None:
    """Strip plot: jittered points along a categorical axis."""
    enc = spec.get("encoding", {})
    cfg = config or {}
    step_width = int(cfg.get("stepWidth", 20))

    # Detect categorical axis
    cat_axis = None
    cont_axis = None
    for axis in ("x", "y"):
        if enc.get(axis, {}).get("type") in ("nominal", "ordinal"):
            cat_axis = axis
            cont_axis = "y" if axis == "x" else "x"
            break

    if cat_axis is None:
        return

    # Set step-based width/height
    dim = "width" if cat_axis == "x" else "height"
    spec[dim] = {"step": step_width}

    # Auto point size
    cat_field = enc[cat_axis].get("field")
    if cat_field and cat_field in df.columns:
        max_group = int(df.groupby(cat_field).size().max())
        cont_dim = spec.get("height" if cat_axis == "x" else "width", 300)
        if isinstance(cont_dim, dict):
            cont_len = 300
        else:
            cont_len = cont_dim
        ideal_size = max(5, min(100, int(0.35 * step_width * cont_len / max(max_group, 1))))
        point_size = int(cfg.get("pointSize", 0)) or ideal_size
    else:
        point_size = int(cfg.get("pointSize", 0)) or 30

    mark = spec.get("mark", {})
    if isinstance(mark, dict):
        mark["size"] = point_size
    else:
        spec["mark"] = {"type": "circle", "opacity": 0.7, "size": point_size}

    # Jitter transform
    jitter_width = step_width * 0.7
    spec.setdefault("transform", []).append({
        "calculate": f"{-jitter_width/2} + random() * {jitter_width}",
        "as": "__jitter",
    })
    offset_ch = "xOffset" if cat_axis == "x" else "yOffset"
    enc[offset_ch] = {
        "field": "__jitter",
        "type": "quantitative",
        "axis": None,
        "scale": {"domain": [-step_width / 2, step_width / 2]},
    }


def _post_process_rose(
    spec: dict, df: pd.DataFrame, encodings: dict, config: dict | None
) -> None:
    """Rose (Nightingale) chart: polar bar using arc mark."""
    enc = spec.get("encoding", {})
    cfg = config or {}

    x_enc = enc.pop("x", None)
    y_enc = enc.pop("y", None)

    # x → theta (the angular/category axis)
    if x_enc:
        theta_enc = {"field": x_enc["field"], "type": "nominal", "stack": True}
        if x_enc.get("sort"):
            theta_enc["sort"] = x_enc["sort"]
        enc["theta"] = theta_enc

    # y → radius
    if y_enc:
        radius_field = y_enc["field"]
        enc["radius"] = {"field": radius_field, "type": "quantitative", "scale": {"type": "sqrt"}}
    else:
        enc["radius"] = {"aggregate": "count", "type": "quantitative", "scale": {"type": "sqrt"}}

    # color: use the explicit color field or fall back to x field
    if "color" not in enc and x_enc:
        enc["color"] = {"field": x_enc["field"], "type": "nominal"}

    # Config
    inner_radius = int(cfg.get("innerRadius", 0))
    pad_angle = float(cfg.get("padAngle", 0.02))
    mark = spec.get("mark", {})
    if isinstance(mark, dict):
        if inner_radius:
            mark["innerRadius"] = inner_radius
        mark["padAngle"] = pad_angle
    else:
        spec["mark"] = {"type": "arc", "stroke": "white", "padAngle": pad_angle}
        if inner_radius:
            spec["mark"]["innerRadius"] = inner_radius

    # Square aspect ratio
    spec["width"] = 300
    spec["height"] = 300


def _apply_semantic_encoding(
    encoding_obj: dict,
    cs: ChannelSemantics,
    channel: str,
    chart_type: str,
    config: dict | None,
) -> None:
    """
    Apply semantic-aware enhancements to a VL encoding object.

    Kept intentionally minimal — only ordinal sort order (months, days).
    Formatting, domains, ticks, zero-baseline, etc. are left to VL
    defaults or handled by the front-end TS library.
    """
    vl_type = encoding_obj.get("type", "nominal")

    # --- Ordinal sort order (months, days, quarters) ---
    if cs.ordinal_sort_order and vl_type in ('ordinal', 'nominal'):
        encoding_obj["sort"] = cs.ordinal_sort_order

    # --- Basic color scheme fallback ---
    if vl_type == 'nominal' and channel == 'color':
        encoding_obj.setdefault("scale", {}).setdefault("scheme", "tableau10")


def _apply_spec_quality(
    spec: dict,
    table_data: list[dict],
    df: pd.DataFrame,
    chart_type: str,
) -> list[dict]:
    """
    Post-processing quality improvements for VL specs.

    Mirrors the TS ``vlApplyLayoutToSpec`` logic in instantiate-spec.ts.
    Returns (potentially filtered) table_data.
    """
    encoding = spec.get("encoding", {})
    config = spec.setdefault("config", {})

    # ── 1. Filter nulls for line / area y-field (prevents broken lines) ───
    #    Default VL behaviour leaves gaps at null points.  Filtering them
    #    out from the data connects the line across missing values.
    if chart_type in ('line', 'area'):
        y_field = encoding.get("y", {}).get("field")
        if y_field:
            table_data = [
                row for row in table_data
                if row.get(y_field) is not None
                and not (isinstance(row.get(y_field), float) and pd.isna(row[y_field]))
            ]

    # ── 2. Tooltips ───────────────────────────────────────────────────────
    config.setdefault("mark", {})["tooltip"] = True

    # ── 3. Canvas sizing defaults ─────────────────────────────────────────
    view = config.setdefault("view", {})
    view.setdefault("continuousWidth", 400)
    view.setdefault("continuousHeight", 300)

    # ── 4. Axis label limits (prevent long labels from overflowing) ──────
    ax_x = config.setdefault("axisX", {})
    ax_x.setdefault("labelLimit", 120)
    ax_y = config.setdefault("axisY", {})
    ax_y.setdefault("labelLimit", 120)

    # ── 5. Step-based sizing for wide discrete axes ───────────────────────
    for axis_ch, dim_key in [("x", "width"), ("y", "height")]:
        enc = encoding.get(axis_ch, {})
        if (
            enc.get("type") in ("nominal", "ordinal")
            and enc.get("field")
            and dim_key not in spec
        ):
            field = enc["field"]
            if field in df.columns:
                n_unique = df[field].nunique()
                if n_unique > 12:
                    step = max(12, min(30, 600 // n_unique))
                    spec[dim_key] = {"step": step}

    # ── 6. X-axis label rotation for crowded labels ──────────────────────
    x_enc = encoding.get("x", {})
    if x_enc.get("type") in ("nominal", "ordinal") and x_enc.get("field"):
        field = x_enc["field"]
        if field in df.columns:
            n_unique = df[field].nunique()
            vals = df[field].dropna().astype(str)
            max_label_len = int(vals.str.len().max()) if len(vals) > 0 else 0
            if n_unique > 8 or (n_unique > 4 and max_label_len > 10):
                if "labelAngle" not in ax_x:
                    ax_x["labelAngle"] = -45
                    ax_x["labelAlign"] = "right"
                    ax_x["labelBaseline"] = "top"

    # ── 7. Facet header limits ────────────────────────────────────────────
    for facet_ch in ("facet", "column", "row"):
        enc = encoding.get(facet_ch)
        if enc and enc.get("field") and enc["field"] in df.columns:
            n_facets = df[enc["field"]].nunique()
            if n_facets > 6:
                config.setdefault("header", {}).update({
                    "labelLimit": 120, "labelFontSize": 9,
                })
                break

    # ── 8. Faceted chart lighter axis titles ──────────────────────────────
    has_row = "row" in encoding
    has_col = "column" in encoding or "facet" in encoding
    if has_row or has_col:
        light_title = {
            "titleFontWeight": "normal",
            "titleFontSize": 11,
            "titleColor": "#666",
        }
        for ax_key in ("axisX", "axisY"):
            ax_cfg = config.setdefault(ax_key, {})
            for k, v in light_title.items():
                ax_cfg.setdefault(k, v)

    # ── 9. Dual-legend repositioning ──────────────────────────────────────
    #    When two+ channels produce legends (e.g. color + size), move the
    #    categorical legend to the bottom to free plot area width.
    legend_channels = [
        ch for ch in ("color", "size", "shape", "opacity")
        if ch in encoding and encoding[ch].get("field")
    ]
    if len(legend_channels) >= 2:
        cat_chs = [
            ch for ch in legend_channels
            if encoding[ch].get("type") in ("nominal", "ordinal")
        ]
        quant_chs = [
            ch for ch in legend_channels
            if encoding[ch].get("type") in ("quantitative", "temporal")
        ]
        if cat_chs and quant_chs:
            for ch in cat_chs:
                legend = encoding[ch].setdefault("legend", {})
                legend["orient"] = "bottom"
                legend["direction"] = "horizontal"

    return table_data


def _apply_chart_config(spec: dict, chart_type: str, config: dict):
    """Apply optional config overrides to a Vega-Lite spec."""
    if not config:
        return
    
    def _ensure_mark_obj(s):
        """Convert string mark to object so we can add properties."""
        if isinstance(s.get("mark"), str):
            s["mark"] = {"type": s["mark"]}
    
    if chart_type == "histogram":
        bin_count = config.get("binCount")
        if bin_count and "encoding" in spec and "x" in spec["encoding"]:
            spec["encoding"]["x"]["bin"] = {"maxbins": int(bin_count)}
    
    elif chart_type == "pie":
        inner_radius = config.get("innerRadius")
        if inner_radius is not None:
            _ensure_mark_obj(spec)
            spec["mark"]["innerRadius"] = int(inner_radius)
    
    elif chart_type == "heatmap":
        color_scheme = config.get("colorScheme")
        if color_scheme and "encoding" in spec and "color" in spec["encoding"]:
            spec["encoding"]["color"].setdefault("scale", {})["scheme"] = color_scheme
    
    elif chart_type == "point":
        opacity = config.get("opacity")
        if opacity is not None:
            _ensure_mark_obj(spec)
            spec["mark"]["opacity"] = float(opacity)
    
    elif chart_type in ("bar", "group_bar", "stacked_bar"):
        corner_radius = config.get("cornerRadius")
        if corner_radius is not None:
            _ensure_mark_obj(spec)
            spec["mark"]["cornerRadius"] = int(corner_radius)
    
    elif chart_type in ("line", "dotted_line"):
        interpolate = config.get("interpolate")
        if interpolate:
            _ensure_mark_obj(spec)
            spec["mark"]["interpolate"] = interpolate
    
    elif chart_type == "area":
        interpolate = config.get("interpolate")
        opacity = config.get("opacity")
        stack_mode = config.get("stackMode")
        _ensure_mark_obj(spec)
        if interpolate:
            spec["mark"]["interpolate"] = interpolate
        if opacity is not None:
            spec["mark"]["opacity"] = float(opacity)
        if stack_mode and "encoding" in spec:
            for axis in ("y", "x"):
                enc = spec["encoding"].get(axis)
                if enc and enc.get("type") == "quantitative":
                    if stack_mode == "normalize":
                        enc["stack"] = "normalize"
                    elif stack_mode == "center":
                        enc["stack"] = "center"
                    elif stack_mode == "layered":
                        enc["stack"] = None
                    break
    
    elif chart_type == "worldmap":
        projection = config.get("projection")
        projection_center = config.get("projectionCenter")
        if projection and "layer" in spec:
            for layer in spec["layer"]:
                if "projection" in layer:
                    layer["projection"]["type"] = projection
        if projection_center and "layer" in spec:
            # projectionCenter [lon, lat] → rotate [-lon, -lat, 0]
            lon, lat = projection_center
            for layer in spec["layer"]:
                if "projection" in layer:
                    layer["projection"]["rotate"] = [-lon, -lat, 0]


def _get_top_values(df: pd.DataFrame, field_name: str, unique_values: list, 
                   channel: str, spec: dict, max_values: int) -> list:
    """
    Get top values for nominal fields with many entries.
    """
    if channel in ['x', 'y']:
        # Find opposite quantitative channel for sorting
        opposite_channel = 'y' if channel == 'x' else 'x'
        opposite_encoding = spec["encoding"].get(opposite_channel)
        
        if (opposite_encoding and 
            opposite_encoding.get("type") == "quantitative"):
            # Sort by quantitative field sum
            quant_field = opposite_encoding["field"]
            value_sums = []
            
            for val in unique_values:
                subset = df[df[field_name] == val]
                total = subset[quant_field].sum() if quant_field in df.columns else 0
                value_sums.append((val, total))
            
            # Sort by sum descending and take top values
            value_sums.sort(key=lambda x: x[1], reverse=True)
            return [val for val, _ in value_sums[:max_values]]
    
    elif channel == 'row':
        # Limit rows more strictly
        return unique_values[:20]
    
    # Default: just take first N values
    return unique_values[:max_values]


def vl_spec_to_png(spec: dict, output_path: str | None = None, scale: float = 1.0) -> bytes:
    """
    Convert a Vega-Lite specification to a PNG image.
    
    Parameters:
    - spec: Vega-Lite specification dictionary
    - output_path: Optional path to save the PNG file
    - scale: Scale factor for higher resolution (default 1.0)
    
    Returns:
    - bytes: PNG image data
    
    Requires: pip install vl-convert-python
    """

    # Convert directly to PNG bytes using vl-convert with higher scale for better fidelity
    png_data = vlc.vegalite_to_png(spec, scale=scale, ppi=150)
    
    # Save to file if path provided
    if output_path:
        with open(output_path, 'wb') as f:
            f.write(png_data)
        print(f"Chart saved to {output_path}")
    
    return png_data

def spec_to_base64(spec: dict, scale: float = 1.0) -> str:
    """
    Convert a Vega-Lite specification to a base64 encoded PNG string.
    
    Parameters:
    - spec: Vega-Lite specification dictionary
    - width: Optional width in pixels (defaults to spec width or 400)
    - height: Optional height in pixels (defaults to spec height or 300)
    - scale: Scale factor for higher resolution (default 2.0 for 2x resolution)
    
    Returns:
    - str: Base64 encoded PNG data (data:image/png;base64,...)
    
    Requires: pip install vl-convert-python
    """
    # Get PNG bytes with higher fidelity
    png_data = vl_spec_to_png(spec, scale=scale)
    
    # Convert to base64
    base64_string = base64.b64encode(png_data).decode('utf-8')
    
    return f"data:image/png;base64,{base64_string}"