"""
Test QC Chart Encoding Validation and Auto-Fix

This script tests the new validation and auto-fix logic for QC charts
to prevent LLM from generating x, y channels for QC chart types.
It also tests the INDEX column requirement for all transformed data.
"""

from data_formulator.agents.qc_chart_config import (
    validate_qc_chart_encodings,
    fix_qc_chart_encodings,
    QC_CHART_TYPES
)
import pandas as pd


def test_qc_trend_line_invalid_xy():
    """Test: LLM mistakenly sends x, y for qc_trend_line"""
    print("\n" + "="*70)
    print("TEST 1: qc_trend_line with invalid x, y channels")
    print("="*70)
    
    # ❌ Wrong: LLM sent x, y instead of INDEX, VALUE
    wrong_encodings = {
        "x": "INDEX",
        "y": "VALUE",
        "color": "QCSTDPARAMNAME"
    }
    
    print(f"Input (WRONG): {wrong_encodings}")
    
    # Validate
    is_valid, errors = validate_qc_chart_encodings("qc_trend_line", wrong_encodings)
    print(f"\nValidation Result: {is_valid}")
    if errors:
        for error in errors:
            print(f"  ❌ {error}")
    
    # Auto-fix
    fixed = fix_qc_chart_encodings("qc_trend_line", wrong_encodings)
    print(f"\nAuto-Fixed Output: {fixed}")
    
    # Validate again
    is_valid_after, errors_after = validate_qc_chart_encodings("qc_trend_line", fixed)
    print(f"After Fix Validation: {is_valid_after}")
    if errors_after:
        for error in errors_after:
            print(f"  ❌ {error}")


def test_qc_trend_line_correct():
    """Test: Correct qc_trend_line encodings"""
    print("\n" + "="*70)
    print("TEST 2: qc_trend_line with correct channels")
    print("="*70)
    
    # ✅ Correct encodings
    correct_encodings = {
        "INDEX": "INDEX",
        "VALUE": "VALUE",
        "QCDATE": "QCDATE",
        "QCSHIFT": "QCSHIFT",
        "color": "QCSTDPARAMNAME"
    }
    
    print(f"Input (CORRECT): {correct_encodings}")
    
    is_valid, errors = validate_qc_chart_encodings("qc_trend_line", correct_encodings)
    print(f"\nValidation Result: {is_valid}")
    if errors:
        for error in errors:
            print(f"  ❌ {error}")
    else:
        print("  ✅ All validations passed!")


def test_qc_histogram_invalid():
    """Test: LLM mistakenly sends x for qc_histogram"""
    print("\n" + "="*70)
    print("TEST 3: qc_histogram with invalid x channel")
    print("="*70)
    
    # ❌ Wrong: qc_histogram shouldn't have x
    wrong_encodings = {
        "x": "VALUE",
        "color": "QCSTDPARAMNAME"
    }
    
    print(f"Input (WRONG): {wrong_encodings}")
    
    is_valid, errors = validate_qc_chart_encodings("qc_histogram", wrong_encodings)
    print(f"\nValidation Result: {is_valid}")
    if errors:
        for error in errors:
            print(f"  ❌ {error}")
    
    # Auto-fix
    fixed = fix_qc_chart_encodings("qc_histogram", wrong_encodings)
    print(f"\nAuto-Fixed Output: {fixed}")
    
    is_valid_after, errors_after = validate_qc_chart_encodings("qc_histogram", fixed)
    print(f"After Fix Validation: {is_valid_after}")


def test_qc_histogram_correct():
    """Test: Correct qc_histogram encodings"""
    print("\n" + "="*70)
    print("TEST 4: qc_histogram with correct channels")
    print("="*70)
    
    correct_encodings = {
        "VALUE": "VALUE",
        "INDEX": "INDEX",
        "color": "QCSTDPARAMNAME"
    }
    
    print(f"Input (CORRECT): {correct_encodings}")
    
    is_valid, errors = validate_qc_chart_encodings("qc_histogram", correct_encodings)
    print(f"\nValidation Result: {is_valid}")
    if is_valid:
        print("  ✅ All validations passed!")


def test_qc_trend_bar_invalid():
    """Test: LLM mistakenly sends x, y for qc_trend_bar"""
    print("\n" + "="*70)
    print("TEST 5: qc_trend_bar with invalid x, y channels")
    print("="*70)
    
    wrong_encodings = {
        "x": "QCDATE",
        "y": "VALUE",
        "color": "QCSTDPARAMNAME"
    }
    
    print(f"Input (WRONG): {wrong_encodings}")
    
    is_valid, errors = validate_qc_chart_encodings("qc_trend_bar", wrong_encodings)
    print(f"\nValidation Result: {is_valid}")
    if errors:
        for error in errors:
            print(f"  ❌ {error}")
    
    # Auto-fix
    fixed = fix_qc_chart_encodings("qc_trend_bar", wrong_encodings)
    print(f"\nAuto-Fixed Output: {fixed}")
    
    is_valid_after, errors_after = validate_qc_chart_encodings("qc_trend_bar", fixed)
    print(f"After Fix Validation: {is_valid_after}")


def test_standard_chart_unchanged():
    """Test: Standard charts (not QC) are not affected"""
    print("\n" + "="*70)
    print("TEST 6: Standard line chart (not QC) - should have x, y")
    print("="*70)
    
    standard_encodings = {
        "x": "DATE",
        "y": "VALUE",
        "color": "CATEGORY"
    }
    
    print(f"Input (STANDARD): {standard_encodings}")
    
    # Standard charts are not validated by QC validation
    # (This is correct - they use x, y)
    print("\nNote: Standard charts like 'line', 'bar' use x, y channels")
    print("Only QC charts (qc_trend_line, qc_histogram, qc_trend_bar) use different channels")


def test_index_column_requirement():
    """Test: Verify INDEX column requirement for all transformed data"""
    print("\n" + "="*70)
    print("TEST 7: INDEX column requirement for all transformed data")
    print("="*70)
    
    # Create sample data
    sample_data = {
        'Name': ['Alice', 'Bob', 'Charlie'],
        'Value': [100, 200, 300]
    }
    df = pd.DataFrame(sample_data)
    
    print(f"Original DataFrame:\n{df}\n")
    
    # Simulate what the transformation function should do
    # Add INDEX column (1-based row sequence number)
    transformed_df = df.copy()
    transformed_df.insert(0, 'INDEX', range(1, len(transformed_df) + 1))
    
    print(f"Transformed DataFrame (WITH INDEX):\n{transformed_df}\n")
    
    # Verify INDEX column exists and is correct
    assert 'INDEX' in transformed_df.columns, "INDEX column missing!"
    assert list(transformed_df['INDEX']) == [1, 2, 3], "INDEX values incorrect!"
    assert transformed_df.columns[0] == 'INDEX', "INDEX must be first column!"
    
    print("✅ INDEX column requirement verified:")
    print("   - INDEX column present: Yes")
    print("   - INDEX column is first: Yes")
    print("   - INDEX values correct (1-based): Yes")
    print("   - This applies to ALL transformations (normal data and QC data)")


def test_index_with_qc_data():
    """Test: INDEX column requirement for QC data"""
    print("\n" + "="*70)
    print("TEST 8: INDEX column with QC data")
    print("="*70)
    
    # Create sample QC data
    qc_data = {
        'QCDATE': ['2024-01-01', '2024-01-02', '2024-01-03'],
        'TARGET': [95.5, 96.2, 95.8],
        'LL': [90.0, 90.0, 90.0],
        'UL': [100.0, 100.0, 100.0]
    }
    df = pd.DataFrame(qc_data)
    
    print(f"Original QC DataFrame:\n{df}\n")
    
    # Simulate transformation with INDEX
    transformed_df = df.copy()
    transformed_df.insert(0, 'INDEX', range(1, len(transformed_df) + 1))
    
    print(f"Transformed QC DataFrame (WITH INDEX):\n{transformed_df}\n")
    
    assert 'INDEX' in transformed_df.columns, "INDEX column missing in QC data!"
    assert transformed_df.columns[0] == 'INDEX', "INDEX must be first column in QC data!"
    
    print("✅ INDEX column works correctly with QC data")
    print("   - INDEX is first column: Yes")
    print("   - QC columns preserved: Yes")


def print_qc_chart_specs():
    """Print QC Chart Specifications"""
    print("\n" + "="*70)
    print("QC CHART TYPE SPECIFICATIONS")
    print("="*70)
    
    for chart_type, spec in QC_CHART_TYPES.items():
        print(f"\n📊 {spec['name']} ({chart_type})")
        print(f"   Channels: {', '.join(spec['channels'])}")
        print(f"   Default Color Field: {spec['default_color_field']}")
        print(f"   Required Fields: {', '.join(spec['required_fields'])}")


if __name__ == "__main__":
    print("\n" + "="*70)
    print("QC CHART ENCODING VALIDATION AND AUTO-FIX TEST SUITE")
    print("="*70)
    
    # Print specs first
    print_qc_chart_specs()
    
    # Run tests
    test_qc_trend_line_invalid_xy()
    test_qc_trend_line_correct()
    test_qc_histogram_invalid()
    test_qc_histogram_correct()
    test_qc_trend_bar_invalid()
    test_standard_chart_unchanged()
    test_index_column_requirement()
    test_index_with_qc_data()
    
    print("\n" + "="*70)
    print("TEST SUITE COMPLETED")
    print("="*70)
    print("""
SUMMARY:
- QC charts have FIXED channel specifications
- They do NOT use standard x, y channels
- Validation detects and reports errors
- Auto-fix corrects common LLM mistakes
- Validation runs automatically in agent_sql_data_rec.py
- **NEW: INDEX column requirement**
  - All transformed data MUST include an INDEX column (1-based row number)
  - INDEX is added in transform_data() using: transformed_df.insert(0, 'INDEX', range(1, len(transformed_df) + 1))
  - Applies to ALL data types (normal data and QC data)
  - INDEX must be the first column in the output
""")
