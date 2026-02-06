# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
=============================================================================
SEMANTIC TYPE SYSTEM
=============================================================================

Semantic types classify data fields for intelligent chart recommendations.
Uses strings for flexibility and easy JSON serialization.

DESIGN GOALS:
1. Comprehensive: Cover common data types seen in real-world datasets
2. Visualization-aware: Map to Vega-Lite encoding types (Q, O, N, T)
3. Hierarchical: Support generalization via lattice structure
4. Simple: Use strings with helper functions, no complex enums

=============================================================================
"""

from typing import Dict, List, Optional, Set

# ---------------------------------------------------------------------------
# All Semantic Types (as string constants)
# ---------------------------------------------------------------------------

# TEMPORAL TYPES - Time-related concepts
DATETIME = "DateTime"       # Full date and time: "2024-01-15T14:30:00"
DATE = "Date"               # Date only: "2024-01-15"
TIME = "Time"               # Time only: "14:30:00"

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

DURATION = "Duration"       # Time span: "2 hours", "3 days", milliseconds
TIME_RANGE = "TimeRange"    # Time interval: "9am-5pm", "2020-2024"

# NUMERIC MEASURE TYPES - Continuous values for aggregation
QUANTITY = "Quantity"       # Generic continuous measure
COUNT = "Count"             # Discrete count of items
AMOUNT = "Amount"           # Monetary or general amounts
PRICE = "Price"             # Unit price
REVENUE = "Revenue"         # Total revenue/sales
COST = "Cost"               # Expenses/costs
PERCENTAGE = "Percentage"   # 0-100% or 0-1 ratio
RATE = "Rate"               # Rate of change, interest rate
RATIO = "Ratio"             # Proportion between values
DISTANCE = "Distance"       # Length, height, width
AREA = "Area"               # Square units
VOLUME = "Volume"           # Cubic units
WEIGHT = "Weight"           # Mass
TEMPERATURE = "Temperature" # Degrees
SPEED = "Speed"             # Velocity

# NUMERIC DISCRETE TYPES - Numbers with ordinal/identifier meaning
RANK = "Rank"               # Position in ordered list: 1st, 2nd, 3rd
INDEX = "Index"             # Row number, sequence number
ID = "ID"                   # Unique identifier (not for aggregation!)
SCORE = "Score"             # Rating score: 1-5, 1-10, 0-100
RATING = "Rating"           # Star rating, letter grade
LEVEL = "Level"             # Discrete levels: 1, 2, 3

# GEOGRAPHIC TYPES - Location-based data
LATITUDE = "Latitude"       # -90 to 90
LONGITUDE = "Longitude"     # -180 to 180
COORDINATES = "Coordinates" # Lat/Long pair
COUNTRY = "Country"         # Country name or code
STATE = "State"             # State/Province
CITY = "City"               # City name
REGION = "Region"           # Geographic region
ADDRESS = "Address"         # Street address
ZIP_CODE = "ZipCode"        # Postal code
LOCATION = "Location"       # Generic location (fallback)

# CATEGORICAL ENTITY TYPES - Named entities
PERSON_NAME = "PersonName"  # Full name, first/last name
USERNAME = "Username"       # Account username
EMAIL = "Email"             # Email address
COMPANY = "Company"         # Company/Organization name
BRAND = "Brand"             # Brand name
DEPARTMENT = "Department"   # Organizational unit
PRODUCT = "Product"         # Product name
SKU = "SKU"                 # Product identifier
CATEGORY = "Category"       # Product/item category
NAME = "Name"               # Generic named entity (fallback)

# CATEGORICAL CODED TYPES - Discrete categories/statuses
STATUS = "Status"           # State: "Active", "Pending", "Closed"
TYPE = "Type"               # Type classification
BOOLEAN = "Boolean"         # True/False, Yes/No
BINARY = "Binary"           # Two-value categorical
CODE = "Code"               # Coded value: "A", "B", "C"

# BINNED/RANGE TYPES - Discretized continuous values
RANGE = "Range"             # Numeric range: "10000-20000", "<50", "50+"
AGE_GROUP = "AgeGroup"      # Age range: "18-24", "25-34"
BUCKET = "Bucket"           # Generic binned value

# FALLBACK TYPES
STRING = "String"           # Generic string (categorical fallback)
NUMBER = "Number"           # Generic number (measure fallback)
UNKNOWN = "Unknown"         # Cannot determine type


# ---------------------------------------------------------------------------
# All Semantic Types List (for prompt generation)
# ---------------------------------------------------------------------------

ALL_SEMANTIC_TYPES: List[str] = [
    # Temporal
    DATETIME, DATE, TIME,
    YEAR, QUARTER, MONTH, WEEK, DAY, HOUR,
    YEAR_MONTH, YEAR_QUARTER, YEAR_WEEK, DECADE,
    DURATION, TIME_RANGE,
    # Numeric measures
    QUANTITY, COUNT, AMOUNT, PRICE, REVENUE, COST,
    PERCENTAGE, RATE, RATIO,
    DISTANCE, AREA, VOLUME, WEIGHT, TEMPERATURE, SPEED,
    # Numeric discrete
    RANK, INDEX, ID, SCORE, RATING, LEVEL,
    # Geographic
    LATITUDE, LONGITUDE, COORDINATES,
    COUNTRY, STATE, CITY, REGION, ADDRESS, ZIP_CODE, LOCATION,
    # Entity names
    PERSON_NAME, USERNAME, EMAIL, COMPANY, BRAND, DEPARTMENT,
    PRODUCT, SKU, CATEGORY, NAME,
    # Coded
    STATUS, TYPE, BOOLEAN, BINARY, CODE,
    # Ranges
    RANGE, AGE_GROUP, BUCKET,
    # Fallbacks
    STRING, NUMBER, UNKNOWN,
]


# ---------------------------------------------------------------------------
# Type Sets for Classification
# ---------------------------------------------------------------------------

TIMESERIES_X_TYPES: Set[str] = {
    DATETIME, DATE, TIME,
    YEAR_MONTH, YEAR_QUARTER, YEAR_WEEK,
    YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, DECADE,
}

MEASURE_TYPES: Set[str] = {
    QUANTITY, COUNT, AMOUNT, PRICE, REVENUE, COST,
    PERCENTAGE, RATE, RATIO,
    DISTANCE, AREA, VOLUME, WEIGHT, TEMPERATURE, SPEED,
    DURATION, NUMBER,
}

NON_MEASURE_NUMERIC_TYPES: Set[str] = {
    RANK, INDEX, ID, SCORE, RATING, LEVEL,
    YEAR, MONTH, DAY, HOUR,
    LATITUDE, LONGITUDE,
}

CATEGORICAL_TYPES: Set[str] = {
    NAME, PERSON_NAME, USERNAME, EMAIL,
    COMPANY, BRAND, DEPARTMENT, PRODUCT, CATEGORY,
    STATUS, TYPE, BOOLEAN, BINARY, CODE,
    LOCATION, COUNTRY, STATE, CITY, REGION,
    RANGE, AGE_GROUP, BUCKET,
    STRING,
}

ORDINAL_TYPES: Set[str] = {
    YEAR, QUARTER, MONTH, WEEK, DAY, HOUR, DECADE,
    RANK, SCORE, RATING, LEVEL,
    RANGE, AGE_GROUP, BUCKET, TIME_RANGE,
}

GEO_TYPES: Set[str] = {
    LATITUDE, LONGITUDE, COORDINATES,
    LOCATION, COUNTRY, STATE, CITY, REGION, ADDRESS, ZIP_CODE,
}


# ---------------------------------------------------------------------------
# Grouped by Category (for prompt generation)
# ---------------------------------------------------------------------------

SEMANTIC_TYPE_CATEGORIES: Dict[str, List[str]] = {
    "Temporal (point-in-time)": [DATETIME, DATE, TIME],
    "Temporal (granules)": [YEAR, QUARTER, MONTH, WEEK, DAY, HOUR],
    "Temporal (combined)": [YEAR_MONTH, YEAR_QUARTER, YEAR_WEEK, DECADE],
    "Temporal (duration)": [DURATION, TIME_RANGE],
    "Numeric measures": [
        QUANTITY, COUNT, AMOUNT, PRICE, REVENUE, COST,
        PERCENTAGE, RATE, RATIO,
        DISTANCE, AREA, VOLUME, WEIGHT, TEMPERATURE, SPEED
    ],
    "Numeric discrete": [RANK, INDEX, ID, SCORE, RATING, LEVEL],
    "Geographic coordinates": [LATITUDE, LONGITUDE, COORDINATES],
    "Geographic locations": [COUNTRY, STATE, CITY, REGION, ADDRESS, ZIP_CODE, LOCATION],
    "Entity names": [PERSON_NAME, USERNAME, EMAIL, COMPANY, BRAND, DEPARTMENT, PRODUCT, SKU, CATEGORY, NAME],
    "Categorical codes": [STATUS, TYPE, BOOLEAN, BINARY, CODE],
    "Binned ranges": [RANGE, AGE_GROUP, BUCKET],
    "Fallback": [STRING, NUMBER, UNKNOWN],
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
    lines.append("   - Use YearMonth, YearQuarter for combined temporal like '2024-01' or '2024-Q1'")
    lines.append("   - Use Year, Month, Day for discrete time units (even if stored as numbers)")
    lines.append("   - Use Duration for time spans (e.g., '2 hours', milliseconds)")
    lines.append("   - Use TimeRange for intervals (e.g., '9am-5pm', '2020-2024')")
    lines.append("")
    lines.append("2. NUMERIC MEASURE types (can be aggregated/averaged):")
    lines.append("   - Use Quantity for generic continuous measures")
    lines.append("   - Use specific types like Price, Revenue, Percentage when applicable")
    lines.append("   - Use Count for discrete counts of items")
    lines.append("")
    lines.append("3. NUMERIC DISCRETE types (should NOT be aggregated):")
    lines.append("   - Use Rank for positions (1st, 2nd, 3rd)")
    lines.append("   - Use ID for unique identifiers")
    lines.append("   - Use Score/Rating for evaluation scores (1-5, A-F)")
    lines.append("   - IMPORTANT: A column named 'year' with values like 2020, 2021 is Year, not Number!")
    lines.append("")
    lines.append("4. GEOGRAPHIC types:")
    lines.append("   - Use Latitude/Longitude for coordinates")
    lines.append("   - Use Country, State, City for named locations")
    lines.append("   - Use Location as fallback for any geographic entity")
    lines.append("")
    lines.append("5. CATEGORICAL types:")
    lines.append("   - Use specific entity types (PersonName, Company, Product) when applicable")
    lines.append("   - Use Category for classification fields")
    lines.append("   - Use Status for state/status fields ('Active', 'Pending')")
    lines.append("   - Use Boolean for true/false, yes/no fields")
    lines.append("")
    lines.append("6. RANGE types:")
    lines.append("   - Use Range for binned numeric values ('10000-20000', '<50', '50+')")
    lines.append("   - Use AgeGroup specifically for age ranges ('18-24', '25-34')")
    lines.append("")
    lines.append("7. FALLBACK types:")
    lines.append("   - Use String for generic text when no specific type applies")
    lines.append("   - Use Number for generic numeric when no specific measure type applies")
    
    return "\n".join(lines)


# For backward compatibility with existing code
LEGACY_SEMANTIC_TYPES = [
    "Location", "Decade", "Year", "Month", "YearMonth", "Day", 
    "Date", "Time", "DateTime", "TimeRange", "Range", "Duration", 
    "Name", "Percentage", "String", "Number"
]
