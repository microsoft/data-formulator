import pandas as pd
import numpy as np
from typing import Any
import vl_convert as vlc
import base64
import logging

from data_formulator.agents.semantic_types import infer_vl_type_from_name

logger = logging.getLogger(__name__)


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
    if pd.api.types.is_numeric_dtype(series):
        # Check if it looks like a discrete categorical variable
        unique_count = series.nunique()
        total_count = len(series)
        if unique_count <= 20 and unique_count / total_count < 0.5:
            return 'ordinal'
        return 'quantitative'
    elif pd.api.types.is_datetime64_any_dtype(series):
        return 'temporal'
    elif pd.api.types.is_bool_dtype(series):
        return 'nominal'
    else:
        # String or object type
        unique_count = series.nunique()
        if unique_count <= 50:  # Assume categorical if reasonable number of unique values
            return 'nominal'
        return 'nominal'  # Default to nominal for text


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
        "chart": "boxplot",
        "mark": "boxplot",
        "channels": ["x", "y", "opacity", "column", "row"]
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
}

# Chart types where temporal fields on position channels should be ordinal
# (discrete bars/cells rather than a continuous time axis).
# For these charts, coerce_field_type downgrades "temporal" → "ordinal" on x/y.
_BAR_LIKE_CHARTS = {"bar", "group_bar", "stacked_bar"}


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
    
    Returns:
    - dict: Vega-Lite specification
    """
    # Find the chart template
    template = get_chart_template(chart_type)
    if not template:
        raise ValueError(f"Chart type '{chart_type}' not found in templates")
    
    # Build initial spec — some chart types need special structure
    if chart_type == "histogram":
        spec = {
            "mark": "bar",
            "encoding": {
                "x": {"bin": True},
                "y": {"aggregate": "count"}
            }
        }
    elif chart_type in ("worldmap", "usmap"):
        projection_type = "albersUsa" if chart_type == "usmap" else "equalEarth"
        topo_url = (
            "https://vega.github.io/vega-lite/data/us-10m.json" if chart_type == "usmap"
            else "https://vega.github.io/vega-lite/data/world-110m.json"
        )
        topo_feature = "states" if chart_type == "usmap" else "countries"
        spec = {
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
    else:
        spec = {
            "mark": template["mark"],
            "encoding": {}
        }
    
    # Remove duplicate columns before converting to records
    if df.columns.duplicated().any():
        df = df.loc[:, ~df.columns.duplicated()]
    # Add data to the spec (inline data from dataframe)
    table_data = df.to_dict('records')
    
    # Apply encodings with sophisticated handling
    for channel, encoding_input in encodings.items():
        # Parse encoding input (always a dict with "field" property)
        field_name = encoding_input.get("field")
        aggregate_func = encoding_input.get("aggregate")
        
        if not field_name or field_name not in df.columns:
            continue
            
        encoding_obj = {}
        
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
            # Regular field encoding
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
        
        # Scale configurations for quantitative line charts
        if (encoding_obj["type"] == "quantitative" and 
            "line" in chart_type.lower() and 
            channel == "x"):
            encoding_obj["scale"] = {"nice": False}
        
        # Special handling for nominal color encoding
        if encoding_obj["type"] == "nominal" and channel == "color":
            unique_values = df[field_name].unique()
            
            # Large color palettes
            if len(unique_values) >= 16:
                encoding_obj["scale"] = {"scheme": "tableau20"}
                encoding_obj["legend"] = {
                    "symbolSize": 12,
                    "labelFontSize": 8
                }
        
        # For map charts, encodings go into the second layer
        if chart_type in ("worldmap", "usmap"):
            spec["layer"][1]["encoding"][channel] = encoding_obj
        else:
            # Add encoding to spec
            spec["encoding"][channel] = encoding_obj
    
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
    if chart_type == "group_bar" and "color" in spec["encoding"]:
        color_encoding = spec["encoding"]["color"]
        spec["encoding"]["xOffset"] = {
            "field": color_encoding["field"],
            "type": color_encoding.get("type", "nominal")
        }
    
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
    
    # Convert temporal fields to strings for Vega-Lite
    for row in table_data:
        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                row[col] = str(row[col])
    
    spec["data"] = {"values": table_data}
    return spec


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
    
    elif chart_type in ("bar", "group_bar"):
        corner_radius = config.get("cornerRadius")
        if corner_radius is not None:
            _ensure_mark_obj(spec)
            spec["mark"]["cornerRadiusEnd"] = int(corner_radius)
    
    elif chart_type == "line":
        interpolate = config.get("interpolate")
        if interpolate:
            _ensure_mark_obj(spec)
            spec["mark"]["interpolate"] = interpolate
    
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