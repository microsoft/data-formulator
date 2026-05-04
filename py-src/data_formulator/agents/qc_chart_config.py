# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
QC Chart Configuration and Utilities

This module centralizes all QC (Quality Control) chart type definitions,
reducing token overhead when passing chart specifications to LLMs.
Instead of repeating full definitions in prompts, we reference this config.

**IMPORTANT: INDEX Column Requirement**
All transformed data (from transform_data() function) MUST include an INDEX column:
- INDEX is a 1-based row sequence number (1, 2, 3, ...)
- Added using: transformed_df.insert(0, 'INDEX', range(1, len(transformed_df) + 1))
- Applied to ALL transformations (normal data and QC data)
- Must be the FIRST column in the output dataframe
"""

QC_CHART_TYPES = {
    "qc_trend_line": {
        "name": "QC Trend Line",
        "channels": ["INDEX", "VALUE", "QCDATE", "QCSHIFT", "color"],
        "description": "Quality control trend chart that visualizes values and control limits over time",
        "use_case": "Quality control monitoring, tracking values against control limits over time",
        "required_fields": ["TARGET", "SLIPNO", "ITEMNAME"],
        "optional_fields": ["LL", "UL", "ARLL", "ARUL"],
        "control_limit_fields": ["TARGET", "LL", "UL", "ARLL", "ARUL"],
        "default_color_field": "QCSTDPARAMNAME",
        "value_type": "numeric"
    },
    "qc_histogram": {
        "name": "QC Histogram",
        "channels": ["VALUE", "INDEX", "color"],
        "description": "Quality control histogram for distribution analysis of QC values",
        "use_case": "Distribution analysis of QC values",
        "required_fields": ["TARGET"],
        "optional_fields": ["LL", "UL", "ARLL", "ARUL"],
        "control_limit_fields": ["TARGET", "LL", "UL", "ARLL", "ARUL"],
        "default_color_field": "QCSTDPARAMNAME",
        "value_type": "numeric"
    },
    "qc_trend_bar": {
        "name": "QC Trend Bar",
        "channels": ["VALUE", "QCDATE", "QCSHIFT"],
        "description": "Quality control trend bar chart that visualizes categorical values and control limits",
        "use_case": "Quality control monitoring with categorical values",
        "required_fields": ["TARGET", "SLIPNO", "ITEMNAME"],
        "optional_fields": ["LL", "UL", "ARLL", "ARUL"],
        "control_limit_fields": ["TARGET", "LL", "UL", "ARLL", "ARUL"],
        "default_color_field": None,
        "value_type": "categorical"
    }
}

def is_qc_data(column_names):
    """
    Detect if a dataset is QC data based on the presence of control limit columns.
    
    Args:
        column_names: List or set of column names
        
    Returns:
        bool: True if TARGET column exists and at least one control limit column exists
    """
    col_upper = {col.upper() for col in column_names}
    required = {"TARGET"}
    optional = {"LL", "UL", "ARLL", "ARUL"}
    
    has_required = required.issubset(col_upper)
    has_optional = bool(optional.intersection(col_upper))
    
    return has_required and has_optional


def get_qc_chart_def(chart_type):
    """
    Get QC chart definition by type.
    
    Args:
        chart_type: Chart type string (e.g., 'qc_trend_line')
        
    Returns:
        dict: Chart definition or None if not found
    """
    return QC_CHART_TYPES.get(chart_type)


def get_compact_qc_chart_info():
    """
    Get compact QC chart information for prompt inclusion.
    Minimal token usage - only essential fields.
    
    Returns:
        str: Compact formatted QC chart information
    """
    info = "**QC Chart Specifications (FIXED - cannot be modified):**\n\n"
    
    for chart_key, chart_def in QC_CHART_TYPES.items():
        channels_str = ", ".join(chart_def["channels"])
        info += f"- {chart_def['name']} ({chart_key}): channels=[{channels_str}]\n"
    
    return info


def get_full_qc_chart_rules():
    """
    Get complete QC chart rules for detailed prompt inclusion.
    Use this for comprehensive guidance to LLM.
    
    Returns:
        str: Detailed QC chart rules
    """
    rules = """
**QC Chart Type Specifications (FIXED channel definitions):**

For chart_type = "qc_trend_line":
  - Channels: INDEX, VALUE, QCDATE, QCSHIFT, color
  - chart_encodings MUST include: {"INDEX": "INDEX", "VALUE": "VALUE", "QCDATE": "QCDATE", "QCSHIFT": "QCSHIFT", "color": "QCSTDPARAMNAME"}
  - Do NOT include LL, UL, ARLL, ARUL, TARGET in chart_encodings (used internally)
  - output_fields MUST include: INDEX, VALUE, QCDATE, QCSHIFT, QCSTDPARAMNAME, TARGET, LL, UL, ARLL, ARUL, SLIPNO, ITEMNAME
  - Default color field: QCSTDPARAMNAME

For chart_type = "qc_histogram":
  - Channels: VALUE, INDEX, color
  - chart_encodings MUST include: {"VALUE": "VALUE", "INDEX": "INDEX", "color": "QCSTDPARAMNAME"}
  - Do NOT include x-axis field, LL, UL, ARLL, ARUL, TARGET in chart_encodings
  - output_fields MUST include: VALUE, INDEX, QCSTDPARAMNAME, TARGET, LL, UL, ARLL, ARUL, SLIPNO, ITEMNAME
  - Default color field: QCSTDPARAMNAME

For chart_type = "qc_trend_bar":
  - Channels: VALUE, QCDATE, QCSHIFT
  - chart_encodings MUST include: {"VALUE": "VALUE", "QCDATE": "QCDATE", "QCSHIFT": "QCSHIFT"}
  - Do NOT include LL, UL, ARLL, ARUL, TARGET in chart_encodings
  - output_fields MUST include: VALUE, QCDATE, QCSHIFT, SLIPNO, ITEMNAME
"""
    return rules


def format_qc_detection_notes(qc_notes):
    """
    Format QC detection notes for user-friendly output.
    
    Args:
        qc_notes: List of QC detection note strings
        
    Returns:
        str: Formatted notes or empty string
    """
    if not qc_notes:
        return ""
    
    return "**QC Data Detection Notes:**\n" + "\n".join(f"- {note}" for note in qc_notes) + "\n\n"


def suggest_qc_chart_type(has_qc_numeric, has_qc_non_numeric):
    """
    Suggest appropriate QC chart type based on VALUE field type analysis.
    
    Args:
        has_qc_numeric: bool - Dataset has QC data with numeric VALUE
        has_qc_non_numeric: bool - Dataset has QC data with non-numeric VALUE
        
    Returns:
        tuple: (suggested_chart_type, reason) or (None, None) if no suggestion
    """
    if has_qc_numeric and not has_qc_non_numeric:
        return "qc_trend_line", "QC data with numeric VALUE field"
    elif has_qc_non_numeric and not has_qc_numeric:
        return "qc_trend_bar", "QC data with non-numeric VALUE field"
    elif has_qc_numeric and has_qc_non_numeric:
        return "qc_trend_line", "Mixed VALUE types in QC data; prefer numeric trend line"
    
    return None, None


def validate_qc_chart_encodings(chart_type, chart_encodings):
    """
    Validate that chart_encodings match the fixed specification for QC chart type.
    Strict validation: QC charts MUST NOT have x, y channels.
    
    Args:
        chart_type: Chart type string
        chart_encodings: dict of chart encodings from LLM output
        
    Returns:
        tuple: (is_valid, error_messages)
    """
    if not chart_type or chart_type not in QC_CHART_TYPES:
        return False, [f"Unknown chart type: {chart_type}"]
    
    chart_def = QC_CHART_TYPES[chart_type]
    expected_channels = set(chart_def["channels"])
    provided_channels = set(chart_encodings.keys()) if chart_encodings else set()
    
    errors = []
    
    # ⚠️ CRITICAL: QC charts MUST NOT have x or y channels
    forbidden_channels = {"x", "y"}
    forbidden_found = provided_channels & forbidden_channels
    if forbidden_found:
        errors.append(
            f"❌ INVALID: {chart_type} uses specific channels (INDEX, VALUE, QCDATE, QCSHIFT, color), "
            f"NOT standard x/y axes. Found forbidden channels: {forbidden_found}. "
            f"Remove 'x' and 'y' and use the correct channel names instead."
        )
    
    # Check for missing channels
    missing = expected_channels - provided_channels
    if missing:
        errors.append(f"Missing required channels for {chart_type}: {missing}")
    
    # Check for unexpected channels (excluding x, y which we already caught)
    unexpected = (provided_channels - expected_channels) - forbidden_channels
    if unexpected:
        errors.append(f"Unexpected channels for {chart_type}: {unexpected}")
    
    return len(errors) == 0, errors


def fix_qc_chart_encodings(chart_type, chart_encodings):
    """
    Auto-fix common LLM mistakes in QC chart encodings.
    If LLM sends x, y instead of INDEX, VALUE, auto-correct it.
    ALSO auto-populate missing required channels to ensure all channels are present.
    
    Args:
        chart_type: Chart type string
        chart_encodings: dict of chart encodings from LLM output
        
    Returns:
        dict: Corrected chart_encodings with all required channels ensured
    """
    if chart_type not in QC_CHART_TYPES:
        return chart_encodings
    
    if not chart_encodings:
        chart_encodings = {}
    
    fixed = dict(chart_encodings)  # Create a copy
    made_changes = False
    
    # ⚠️ Common LLM mistake: Using x, y instead of INDEX, VALUE
    if chart_type == "qc_trend_line":
        # If x is present, try to map it to INDEX
        if "x" in fixed:
            fixed["INDEX"] = fixed.pop("x")
            made_changes = True
        # If y is present, try to map it to VALUE
        if "y" in fixed:
            fixed["VALUE"] = fixed.pop("y")
            made_changes = True
        
        # ⚠️ CRITICAL: Ensure ALL required channels are present
        required_channels = ["INDEX", "VALUE", "QCDATE", "QCSHIFT", "color"]
        for channel in required_channels:
            if channel not in fixed:
                if channel == "color":
                    fixed[channel] = "QCSTDPARAMNAME"  # Default color field
                else:
                    fixed[channel] = channel  # Use channel name as default field name
                made_changes = True
    
    elif chart_type == "qc_histogram":
        # qc_histogram uses VALUE, INDEX, color (no x, y)
        if "x" in fixed:
            fixed["INDEX"] = fixed.pop("x")
            made_changes = True
        if "y" in fixed:
            # Remove y, it's not used in qc_histogram
            fixed.pop("y")
            made_changes = True
        
        # ⚠️ Ensure ALL required channels for qc_histogram are present
        required_channels = ["VALUE", "INDEX", "color"]
        for channel in required_channels:
            if channel not in fixed:
                if channel == "color":
                    fixed[channel] = "QCSTDPARAMNAME"
                else:
                    fixed[channel] = channel
                made_changes = True
    
    elif chart_type == "qc_trend_bar":
        # qc_trend_bar uses VALUE, QCDATE, QCSHIFT (no x, y)
        if "x" in fixed:
            fixed.pop("x")
            made_changes = True
        if "y" in fixed:
            fixed.pop("y")
            made_changes = True
        
        # ⚠️ Ensure ALL required channels for qc_trend_bar are present
        required_channels = ["VALUE", "QCDATE", "QCSHIFT"]
        for channel in required_channels:
            if channel not in fixed:
                fixed[channel] = channel  # Use channel name as default field name
                made_changes = True
    
    if made_changes:
        print(f"⚠️ Auto-fixed QC chart encodings for {chart_type}")
        print(f"   Original: {chart_encodings}")
        print(f"   Fixed:    {fixed}")
    
    return fixed
