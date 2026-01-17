# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Example: Using QC Chart Config to Optimize Token Usage

This file demonstrates how to use the qc_chart_config module
to efficiently work with QC chart specifications.
"""

from data_formulator.agents.qc_chart_config import (
    QC_CHART_TYPES,
    is_qc_data,
    get_qc_chart_def,
    get_compact_qc_chart_info,
    get_full_qc_chart_rules,
    format_qc_detection_notes,
    suggest_qc_chart_type,
    validate_qc_chart_encodings
)

# Example 1: Detect if data is QC data
def example_detect_qc_data():
    """Example: Detecting QC data from column names"""
    column_names = ["DATE", "VALUE", "TARGET", "LL", "UL", "QCSTDPARAMNAME"]
    
    if is_qc_data(column_names):
        print("✓ This is QC data - can use specialized QC chart types")
    else:
        print("✗ This is not QC data - use standard chart types")


# Example 2: Get compact QC info for LLM prompts (saves tokens!)
def example_compact_qc_info():
    """Example: Getting compact QC info for token-efficient prompts"""
    compact_info = get_compact_qc_chart_info()
    print("Compact QC Info (for LLM prompt):")
    print(compact_info)
    print(f"\nEstimated tokens saved: ~200-300 per API call (vs full rules)")


# Example 3: Get full QC rules when detailed guidance is needed
def example_full_qc_rules():
    """Example: Getting complete QC rules for detailed LLM guidance"""
    full_rules = get_full_qc_chart_rules()
    print("Full QC Rules (for initial system prompt setup):")
    print(full_rules)


# Example 4: Suggest chart type based on VALUE field type
def example_suggest_chart():
    """Example: Auto-suggesting QC chart type"""
    has_numeric = True      # VALUE is numeric
    has_non_numeric = False # No non-numeric VALUE fields
    
    suggested, reason = suggest_qc_chart_type(has_numeric, has_non_numeric)
    print(f"Suggested Chart Type: {suggested}")
    print(f"Reason: {reason}")


# Example 5: Validate chart encodings against fixed spec
def example_validate_encodings():
    """Example: Validating chart encodings match specification"""
    chart_type = "qc_trend_line"
    chart_encodings = {
        "INDEX": "INDEX",
        "VALUE": "VALUE",
        "QCDATE": "QCDATE",
        "QCSHIFT": "QCSHIFT",
        "color": "QCSTDPARAMNAME"
    }
    
    is_valid, errors = validate_qc_chart_encodings(chart_type, chart_encodings)
    
    if is_valid:
        print(f"✓ Chart encodings for {chart_type} are valid")
    else:
        print(f"✗ Validation errors:")
        for error in errors:
            print(f"  - {error}")


# Example 6: Format QC detection notes
def example_format_notes():
    """Example: Formatting QC detection notes"""
    qc_notes = [
        "Table orders contains QC control fields and VALUE is numeric",
        "Table quality contains QC control fields and VALUE is non-numeric"
    ]
    
    formatted = format_qc_detection_notes(qc_notes)
    print(formatted)


if __name__ == "__main__":
    print("=" * 60)
    print("QC Chart Config Usage Examples")
    print("=" * 60)
    
    print("\n1. Detect QC Data:")
    print("-" * 60)
    example_detect_qc_data()
    
    print("\n2. Compact QC Info (Token-Efficient):")
    print("-" * 60)
    example_compact_qc_info()
    
    print("\n3. Full QC Rules (Detailed Guidance):")
    print("-" * 60)
    example_full_qc_rules()
    
    print("\n4. Suggest Chart Type:")
    print("-" * 60)
    example_suggest_chart()
    
    print("\n5. Validate Encodings:")
    print("-" * 60)
    example_validate_encodings()
    
    print("\n6. Format Detection Notes:")
    print("-" * 60)
    example_format_notes()
    
    print("\n" + "=" * 60)
    print("Token Savings Summary")
    print("=" * 60)
    print("""
Before optimization:
  - Each LLM call included full QC chart rules (~400-500 tokens)
  - Multiple calls per session = significant overhead

After optimization:
  - Use get_compact_qc_chart_info() for brief reference (~50 tokens)
  - Use get_full_qc_chart_rules() only for initial system prompt setup
  - Configuration cached in Python = no re-transmission
  - Estimated savings: 300-400 tokens per QC data request
  
For a typical session with 10 QC-related requests:
  - Before: ~4,000-5,000 tokens on QC chart rules alone
  - After: ~500-1,000 tokens on QC chart rules
  - Savings: ~3,000-4,000 tokens (~75% reduction!)
""")
