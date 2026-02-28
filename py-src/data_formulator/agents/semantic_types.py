# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
=============================================================================
SEMANTIC TYPE SYSTEM  (Python mirror of the TypeScript registry)
=============================================================================

The **source of truth** for semantic types lives in the TypeScript library:
    src/lib/agents-chart/core/type-registry.ts

This file mirrors the registered types and provides:
  1. String constants for every type in the TS TYPE_REGISTRY
  2. Classification sets (measures, temporal, categorical, etc.)
  3. Prompt generation for the DataLoadAgent LLM call
  4. VL-type mapping + name-heuristic inference for create_vl_plots.py
  5. Legacy compatibility list

When a type is added/removed in the TS registry, update this file to match.
=============================================================================
"""

from typing import Dict, List, Optional, Set

# ---------------------------------------------------------------------------
# All Semantic Types  (must match TYPE_REGISTRY keys in type-registry.ts)
# ---------------------------------------------------------------------------

# TEMPORAL — DateTime
DATETIME = "DateTime"       # Full date and time: "2024-01-15T14:30:00"
DATE = "Date"               # Date only: "2024-01-15"
TIME = "Time"               # Time only: "14:30:00"
TIMESTAMP = "Timestamp"     # Unix timestamp (seconds or milliseconds since epoch)

# TEMPORAL — DateGranule
YEAR = "Year"               # "2024" (as a time unit, not a measure)
QUARTER = "Quarter"         # "Q1", "Q2", "2024-Q1"
MONTH = "Month"             # "January", "Jan", 1-12
WEEK = "Week"               # "Week 1", 1-52
DAY = "Day"                 # "Monday", "Mon", 1-31
HOUR = "Hour"               # 0-23
YEAR_MONTH = "YearMonth"    # "2024-01", "Jan 2024"
YEAR_QUARTER = "YearQuarter"# "2024-Q1"
YEAR_WEEK = "YearWeek"      # "2024-W01"
DECADE = "Decade"           # "1990s", "2000s"

# TEMPORAL — Duration
DURATION = "Duration"       # Time span: "2 hours", "3 days", milliseconds

# MEASURE — Amount
AMOUNT = "Amount"           # Monetary or general amounts (additive)
PRICE = "Price"             # Unit price (intensive — avg, not sum)
REVENUE = "Revenue"         # Total revenue/sales (additive)
COST = "Cost"               # Expenses/costs (additive)

# MEASURE — Physical
QUANTITY = "Quantity"        # Generic continuous measure (additive)
TEMPERATURE = "Temperature" # Degrees — conditional diverging, arbitrary zero

# MEASURE — Proportion
PERCENTAGE = "Percentage"   # 0-100% or 0-1 ratio (intensive, bounded)

# MEASURE — SignedMeasure
PROFIT = "Profit"                       # Signed additive, conditional diverging
PERCENTAGE_CHANGE = "PercentageChange"  # Signed intensive, conditional diverging
SENTIMENT = "Sentiment"                 # Signed intensive, inherent diverging
CORRELATION = "Correlation"             # Signed intensive, inherent diverging, bounded [-1,1]

# MEASURE — GenericMeasure
COUNT = "Count"             # Discrete count of items (additive)
NUMBER = "Number"           # Generic number (measure fallback)

# DISCRETE
RANK = "Rank"               # Position in ordered list: 1st, 2nd, 3rd
SCORE = "Score"             # Rating score: 1-5, 1-10, 0-100
RATING = "Rating"           # Star rating, letter grade
INDEX = "Index"             # Row number, sequence number

# IDENTIFIER
ID = "ID"                   # Unique identifier (not for aggregation!)

# GEOGRAPHIC — GeoCoordinate
LATITUDE = "Latitude"       # -90 to 90
LONGITUDE = "Longitude"     # -180 to 180

# GEOGRAPHIC — GeoPlace
COUNTRY = "Country"         # Country name or code
STATE = "State"             # State/Province
CITY = "City"               # City name
REGION = "Region"           # Geographic region
ADDRESS = "Address"         # Street address
ZIP_CODE = "ZipCode"        # Postal code

# CATEGORICAL — Entity
PERSON_NAME = "PersonName"  # Full name, first/last name
COMPANY = "Company"         # Company/Organization name
PRODUCT = "Product"         # Product name
CATEGORY = "Category"       # Product/item category
NAME = "Name"               # Generic named entity (fallback)

# CATEGORICAL — Coded
STATUS = "Status"           # State: "Active", "Pending", "Closed"
TYPE = "Type"               # Type classification
BOOLEAN = "Boolean"         # True/False, Yes/No
DIRECTION = "Direction"     # N, S, E, W — cyclic ordinal

# CATEGORICAL — Binned
RANGE = "Range"             # Numeric range: "10000-20000", "<50", "50+"
AGE_GROUP = "AgeGroup"      # Age range: "18-24", "25-34"

# FALLBACKS
STRING = "String"           # Generic string (categorical fallback)
UNKNOWN = "Unknown"         # Cannot determine type


# ---------------------------------------------------------------------------
# All Semantic Types List  (matches TYPE_REGISTRY key order)
# ---------------------------------------------------------------------------

ALL_SEMANTIC_TYPES: List[str] = [
    # Temporal — DateTime
    DATETIME, DATE, TIME, TIMESTAMP,
    # Temporal — DateGranule
    YEAR, QUARTER, MONTH, WEEK, DAY, HOUR,
    YEAR_MONTH, YEAR_QUARTER, YEAR_WEEK, DECADE,
    # Temporal — Duration
    DURATION,
    # Measure — Amount
    AMOUNT, PRICE, REVENUE, COST,
    # Measure — Physical
    QUANTITY, TEMPERATURE,
    # Measure — Proportion
    PERCENTAGE,
    # Measure — SignedMeasure
    PROFIT, PERCENTAGE_CHANGE, SENTIMENT, CORRELATION,
    # Measure — GenericMeasure
    COUNT, NUMBER,
    # Discrete
    RANK, SCORE, RATING, INDEX,
    # Identifier
    ID,
    # Geographic — GeoCoordinate
    LATITUDE, LONGITUDE,
    # Geographic — GeoPlace
    COUNTRY, STATE, CITY, REGION, ADDRESS, ZIP_CODE,
    # Categorical — Entity
    PERSON_NAME, COMPANY, PRODUCT, CATEGORY, NAME,
    # Categorical — Coded
    STATUS, TYPE, BOOLEAN, DIRECTION,
    # Categorical — Binned
    RANGE, AGE_GROUP,
    # Fallbacks
    STRING, UNKNOWN,
]


# ---------------------------------------------------------------------------
# Type Sets for Classification
# ---------------------------------------------------------------------------

TIMESERIES_X_TYPES: Set[str] = {
    DATETIME, DATE, TIME, TIMESTAMP,
    YEAR_MONTH, YEAR_QUARTER, YEAR_WEEK,
    YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, DECADE,
}

MEASURE_TYPES: Set[str] = {
    AMOUNT, PRICE, REVENUE, COST,
    QUANTITY, TEMPERATURE,
    PERCENTAGE,
    PROFIT, PERCENTAGE_CHANGE, SENTIMENT, CORRELATION,
    COUNT, NUMBER,
    DURATION,
}

NON_MEASURE_NUMERIC_TYPES: Set[str] = {
    RANK, INDEX, SCORE, RATING,
    YEAR, MONTH, DAY, HOUR,
    LATITUDE, LONGITUDE,
}

CATEGORICAL_TYPES: Set[str] = {
    NAME, PERSON_NAME, COMPANY, PRODUCT, CATEGORY,
    STATUS, TYPE, BOOLEAN, DIRECTION,
    COUNTRY, STATE, CITY, REGION,
    RANGE, AGE_GROUP,
    STRING,
}

ORDINAL_TYPES: Set[str] = {
    YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, DECADE,
    RANK, SCORE, RATING,
    RANGE, AGE_GROUP,
    DIRECTION,
}

GEO_TYPES: Set[str] = {
    LATITUDE, LONGITUDE,
    COUNTRY, STATE, CITY, REGION, ADDRESS, ZIP_CODE,
}

SIGNED_MEASURE_TYPES: Set[str] = {
    PROFIT, PERCENTAGE_CHANGE, SENTIMENT, CORRELATION,
}


# ---------------------------------------------------------------------------
# Grouped by Category  (for prompt generation)
# ---------------------------------------------------------------------------

SEMANTIC_TYPE_CATEGORIES: Dict[str, List[str]] = {
    "Temporal (point-in-time)": [DATETIME, DATE, TIME, TIMESTAMP],
    "Temporal (granules)": [YEAR, QUARTER, MONTH, WEEK, DAY, HOUR],
    "Temporal (combined)": [YEAR_MONTH, YEAR_QUARTER, YEAR_WEEK, DECADE],
    "Temporal (duration)": [DURATION],
    "Numeric measures (monetary)": [AMOUNT, PRICE, REVENUE, COST],
    "Numeric measures (physical)": [QUANTITY, TEMPERATURE],
    "Numeric measures (proportion)": [PERCENTAGE],
    "Numeric measures (signed/diverging)": [PROFIT, PERCENTAGE_CHANGE, SENTIMENT, CORRELATION],
    "Numeric measures (generic)": [COUNT, NUMBER],
    "Numeric discrete": [RANK, INDEX, SCORE, RATING],
    "Identifier": [ID],
    "Geographic coordinates": [LATITUDE, LONGITUDE],
    "Geographic locations": [COUNTRY, STATE, CITY, REGION, ADDRESS, ZIP_CODE],
    "Entity names": [PERSON_NAME, COMPANY, PRODUCT, CATEGORY, NAME],
    "Categorical codes": [STATUS, TYPE, BOOLEAN, DIRECTION],
    "Binned ranges": [RANGE, AGE_GROUP],
    "Fallback": [STRING, UNKNOWN],
}


# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------

def is_measure_type(semantic_type: str) -> bool:
    """Check if a semantic type is a true measure (suitable for quantitative encoding)."""
    return semantic_type in MEASURE_TYPES


def is_timeseries_type(semantic_type: str) -> bool:
    """Check if a semantic type is suitable for time-series X axis."""
    return semantic_type in TIMESERIES_X_TYPES


def is_categorical_type(semantic_type: str) -> bool:
    """Check if a semantic type is categorical (suitable for color/grouping)."""
    return semantic_type in CATEGORICAL_TYPES


def is_ordinal_type(semantic_type: str) -> bool:
    """Check if a semantic type is ordinal (has inherent order)."""
    return semantic_type in ORDINAL_TYPES


def is_geo_type(semantic_type: str) -> bool:
    """Check if a semantic type is geographic."""
    return semantic_type in GEO_TYPES


def is_non_measure_numeric(semantic_type: str) -> bool:
    """Check if a semantic type is numeric but should not be aggregated."""
    return semantic_type in NON_MEASURE_NUMERIC_TYPES


def is_signed_measure(semantic_type: str) -> bool:
    """Check if a semantic type is a signed measure (can go negative)."""
    return semantic_type in SIGNED_MEASURE_TYPES


# ---------------------------------------------------------------------------
# Prompt Generation
# ---------------------------------------------------------------------------

def generate_semantic_types_prompt() -> str:
    """Generate the semantic types section for the LLM prompt."""

    lines = ["Semantic types to consider (grouped by category):"]
    lines.append("")

    for category, types in SEMANTIC_TYPE_CATEGORIES.items():
        lines.append(f"  {category}:")
        lines.append(f"    {', '.join(types)}")

    lines.append("")
    lines.append("Guidelines for choosing semantic types:")
    lines.append("")
    lines.append("1. TEMPORAL types:")
    lines.append("   - Use DateTime/Date/Time for full timestamps or dates")
    lines.append("   - Use Timestamp for Unix timestamps (seconds or milliseconds since epoch)")
    lines.append("   - Use YearMonth, YearQuarter for combined temporal like '2024-01' or '2024-Q1'")
    lines.append("   - Use Year, Month, Day for discrete time units (even if stored as numbers)")
    lines.append("   - Use Duration for time spans (e.g., '2 hours', milliseconds)")
    lines.append("")
    lines.append("2. MONETARY MEASURE types:")
    lines.append("   - Use Amount for generic monetary values")
    lines.append("   - Use Price for per-unit prices (averaged, not summed)")
    lines.append("   - Use Revenue/Cost for totals (summed)")
    lines.append("   - Use Profit for values that can be negative (profit/loss)")
    lines.append("")
    lines.append("3. PHYSICAL / GENERIC MEASURE types:")
    lines.append("   - Use Quantity for generic continuous measures (weight, distance, area, volume, speed, etc.)")
    lines.append("   - Provide the 'unit' field for physical quantities (e.g., 'kg', 'km', '°C', 'mph')")
    lines.append("   - Use Temperature for temperature values (has special diverging color behavior)")
    lines.append("   - Use Count for discrete counts of items")
    lines.append("   - Use Number only when no more specific measure type applies")
    lines.append("")
    lines.append("4. PROPORTION & SIGNED MEASURE types:")
    lines.append("   - Use Percentage for 0-100% or 0-1 ratios")
    lines.append("   - Use PercentageChange for growth rates or % change (can be negative)")
    lines.append("   - Use Sentiment for sentiment scores (inherently diverging around 0)")
    lines.append("   - Use Correlation for correlation coefficients (bounded -1 to 1)")
    lines.append("")
    lines.append("5. NUMERIC DISCRETE types (should NOT be aggregated):")
    lines.append("   - Use Rank for positions (1st, 2nd, 3rd)")
    lines.append("   - Use ID for unique identifiers")
    lines.append("   - Use Score/Rating for evaluation scores (1-5, A-F)")
    lines.append("   - For Score/Rating, provide 'intrinsic_domain' as [min, max] inferred from the data (e.g., [1, 10] if values range 1-10)")
    lines.append("   - IMPORTANT: A column named 'year' with values like 2020, 2021 is Year, not Number!")
    lines.append("")
    lines.append("6. GEOGRAPHIC types:")
    lines.append("   - Use Latitude/Longitude for coordinates")
    lines.append("   - Use Country, State, City for named locations")
    lines.append("")
    lines.append("7. CATEGORICAL types:")
    lines.append("   - Use specific entity types (PersonName, Company, Product) when applicable")
    lines.append("   - Use Category for classification fields")
    lines.append("   - Use Status for state/status fields ('Active', 'Pending')")
    lines.append("   - Use Boolean for true/false, yes/no fields")
    lines.append("   - Use Direction for compass directions (N, S, E, W)")
    lines.append("")
    lines.append("8. RANGE types:")
    lines.append("   - Use Range for binned numeric values ('10000-20000', '<50', '50+')")
    lines.append("   - Use AgeGroup specifically for age ranges ('18-24', '25-34')")
    lines.append("")
    lines.append("9. FALLBACK types:")
    lines.append("   - Use String for generic text when no specific type applies")
    lines.append("   - Do NOT use generic names like 'Value', 'Data', etc. — pick the closest match above")

    return "\n".join(lines)


# For backward compatibility with existing code
LEGACY_SEMANTIC_TYPES = [
    "Location", "Decade", "Year", "Month", "YearMonth", "Day",
    "Date", "Time", "DateTime", "TimeRange", "Range", "Duration",
    "Name", "Percentage", "String", "Number"
]


# ---------------------------------------------------------------------------
# Semantic Type → Vega-Lite Encoding Type
# ---------------------------------------------------------------------------

VL_TYPE_MAP: Dict[str, str] = {
    # Temporal → temporal
    "DateTime": "temporal", "Date": "temporal", "Time": "temporal", "Timestamp": "temporal",
    "YearMonth": "temporal", "YearQuarter": "temporal", "YearWeek": "temporal",
    "Year": "temporal",

    # Temporal granules → ordinal
    "Quarter": "ordinal", "Month": "ordinal",
    "Week": "ordinal", "Day": "ordinal", "Hour": "ordinal", "Decade": "ordinal",

    # Duration → quantitative
    "Duration": "quantitative",

    # Measures → quantitative
    "Amount": "quantitative", "Price": "quantitative", "Revenue": "quantitative", "Cost": "quantitative",
    "Quantity": "quantitative", "Temperature": "quantitative",
    "Percentage": "quantitative",
    "Profit": "quantitative", "PercentageChange": "quantitative",
    "Sentiment": "quantitative", "Correlation": "quantitative",
    "Count": "quantitative", "Number": "quantitative",

    # Discrete numerics
    "Rank": "ordinal", "Index": "ordinal",
    "Score": "quantitative", "Rating": "quantitative",
    "ID": "nominal",

    # Geographic coordinates → quantitative
    "Latitude": "quantitative", "Longitude": "quantitative",

    # Geographic locations → nominal
    "Country": "nominal", "State": "nominal", "City": "nominal",
    "Region": "nominal", "Address": "nominal", "ZipCode": "nominal",

    # Entity names → nominal
    "Name": "nominal", "PersonName": "nominal",
    "Company": "nominal", "Product": "nominal", "Category": "nominal",

    # Coded → nominal (Direction can be ordinal but defaults nominal for VL)
    "Status": "nominal", "Type": "nominal", "Boolean": "nominal",
    "Direction": "nominal",

    # Ranges → ordinal
    "Range": "ordinal", "AgeGroup": "ordinal",

    # Fallbacks
    "String": "nominal", "Unknown": "nominal",
}


def get_vl_type(semantic_type: str) -> Optional[str]:
    """
    Get the Vega-Lite encoding type for a semantic type.
    Returns 'quantitative', 'ordinal', 'nominal', or 'temporal', or None if unknown.
    """
    return VL_TYPE_MAP.get(semantic_type)


# ---------------------------------------------------------------------------
# Name-based Heuristic Inference
# ---------------------------------------------------------------------------
#
# For derived columns (from agent code) that lack frontend semantic type
# metadata, infer a likely VL type from the column name.
#
# Pattern matching is intentionally conservative — only triggers when
# the column name strongly suggests a specific meaning.
# ---------------------------------------------------------------------------

import re as _re

# Patterns that strongly indicate quantitative (measures)
_QUANT_PATTERNS: list[_re.Pattern] = [
    _re.compile(r'(?:^|_)(avg|mean|average|sum|total|count|num|min|max|median|std|stdev|var|variance)(?:_|$)', _re.I),
    _re.compile(r'(?:^|_)(revenue|sales|profit|income|cost|expense|price|amount|quantity|volume|weight|distance|speed|temperature|rate|ratio|pct|percent|percentage|growth|change|diff|delta)(?:_|$)', _re.I),
    _re.compile(r'(?:^|_)(lat|lon|latitude|longitude)(?:_|$)', _re.I),
]

# Patterns that indicate temporal
_TEMPORAL_PATTERNS: list[_re.Pattern] = [
    _re.compile(r'(?:^|_)(date|datetime|timestamp|time|created_at|updated_at|started_at|ended_at)(?:_|$)', _re.I),
    _re.compile(r'^year$', _re.I),
]

# Patterns that indicate ordinal (time granules)
_ORDINAL_PATTERNS: list[_re.Pattern] = [
    _re.compile(r'^(month|quarter|week|day|hour|decade|year_month|year_quarter)$', _re.I),
    _re.compile(r'(?:^|_)(rank|ranking|level|tier|grade|priority)(?:_|$)', _re.I),
]

# Patterns that indicate nominal (categorical)
_NOMINAL_PATTERNS: list[_re.Pattern] = [
    _re.compile(r'(?:^|_)(name|label|category|type|status|group|class|kind|tag|code|id|key)(?:_|$)', _re.I),
    _re.compile(r'(?:^|_)(country|state|city|region|location|department|brand|company|product)(?:_|$)', _re.I),
]


def infer_vl_type_from_name(column_name: str) -> Optional[str]:
    """
    Infer a likely Vega-Lite type from a column name using pattern matching.
    Returns 'quantitative', 'ordinal', 'nominal', 'temporal', or None if
    no strong signal is found.
    """
    # Check patterns in priority order
    for pattern in _TEMPORAL_PATTERNS:
        if pattern.search(column_name):
            return 'temporal'

    for pattern in _ORDINAL_PATTERNS:
        if pattern.search(column_name):
            return 'ordinal'

    for pattern in _QUANT_PATTERNS:
        if pattern.search(column_name):
            return 'quantitative'

    for pattern in _NOMINAL_PATTERNS:
        if pattern.search(column_name):
            return 'nominal'

    return None
