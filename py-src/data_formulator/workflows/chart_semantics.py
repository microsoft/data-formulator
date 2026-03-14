# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
=============================================================================
CHART SEMANTICS — Lightweight type resolution for VL spec assembly
=============================================================================

Provides semantic-aware type resolution for create_vl_plots.py:
  - Type registry (maps semantic types → VL encoding types)
  - VL type resolution (nominal / ordinal / temporal / quantitative)
  - Ordinal sort order (months, days, quarters)

This is intentionally minimal.  The TS agents-chart library is the
canonical source of truth for formatting, color schemes, tick
constraints, domain constraints, and other visual refinements.
The Python side focuses on getting the structural type decisions right
(which directly affect chart shape), and leaves cosmetic details to
defaults or the front-end.
=============================================================================
"""

from __future__ import annotations

import re
import math
from dataclasses import dataclass
from datetime import datetime, date
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# §1  Type Registry  (mirrors type-registry.ts)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TypeRegistryEntry:
    t0: str               # Top-level family
    t1: str               # Mid-level category
    vis_encodings: tuple   # Primary VL types, e.g. ('quantitative',)
    agg_role: str          # additive | intensive | signed-additive | dimension | identifier
    domain_shape: str      # open | bounded | fixed | cyclic


_UNKNOWN = TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open')

TYPE_REGISTRY: Dict[str, TypeRegistryEntry] = {
    # --- Temporal: DateTime ---
    'DateTime':    TypeRegistryEntry('Temporal', 'DateTime', ('temporal',), 'dimension', 'open'),
    'Date':        TypeRegistryEntry('Temporal', 'DateTime', ('temporal',), 'dimension', 'open'),
    'Time':        TypeRegistryEntry('Temporal', 'DateTime', ('temporal',), 'dimension', 'open'),
    'Timestamp':   TypeRegistryEntry('Temporal', 'DateTime', ('temporal',), 'dimension', 'open'),
    # --- Temporal: DateGranule ---
    'Year':        TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open'),
    'Quarter':     TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic'),
    'Month':       TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic'),
    'Week':        TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic'),
    'Day':         TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic'),
    'Hour':        TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic'),
    'YearMonth':   TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open'),
    'YearQuarter': TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open'),
    'YearWeek':    TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open'),
    'Decade':      TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open'),
    # --- Temporal: Duration ---
    'Duration':    TypeRegistryEntry('Temporal', 'Duration', ('quantitative',), 'additive', 'open'),
    # --- Measure: Amount ---
    'Amount':      TypeRegistryEntry('Measure', 'Amount', ('quantitative',), 'additive', 'open'),
    'Price':       TypeRegistryEntry('Measure', 'Amount', ('quantitative',), 'intensive', 'open'),
    # --- Measure: Physical ---
    'Quantity':    TypeRegistryEntry('Measure', 'Physical', ('quantitative',), 'additive', 'open'),
    'Temperature': TypeRegistryEntry('Measure', 'Physical', ('quantitative',), 'intensive', 'open'),
    # --- Measure: Proportion ---
    'Percentage':  TypeRegistryEntry('Measure', 'Proportion', ('quantitative',), 'intensive', 'bounded'),
    # --- Measure: SignedMeasure ---
    'Profit':              TypeRegistryEntry('Measure', 'SignedMeasure', ('quantitative',), 'signed-additive', 'open'),
    'PercentageChange':    TypeRegistryEntry('Measure', 'SignedMeasure', ('quantitative',), 'intensive', 'open'),
    'Sentiment':           TypeRegistryEntry('Measure', 'SignedMeasure', ('quantitative',), 'intensive', 'open'),
    'Correlation':         TypeRegistryEntry('Measure', 'SignedMeasure', ('quantitative',), 'intensive', 'bounded'),
    # --- Measure: GenericMeasure ---
    'Count':       TypeRegistryEntry('Measure', 'GenericMeasure', ('quantitative',), 'additive', 'open'),
    'Number':      TypeRegistryEntry('Measure', 'GenericMeasure', ('quantitative',), 'additive', 'open'),
    # --- Discrete ---
    'Rank':        TypeRegistryEntry('Discrete', 'Rank', ('ordinal',), 'dimension', 'open'),
    'Score':       TypeRegistryEntry('Discrete', 'Score', ('quantitative', 'ordinal'), 'intensive', 'bounded'),
    'ID':          TypeRegistryEntry('Identifier', 'ID', ('nominal',), 'identifier', 'open'),
    # --- Geographic ---
    'Country':     TypeRegistryEntry('Categorical', 'GeoPlace', ('nominal',), 'dimension', 'open'),
    'State':       TypeRegistryEntry('Categorical', 'GeoPlace', ('nominal',), 'dimension', 'open'),
    'City':        TypeRegistryEntry('Categorical', 'GeoPlace', ('nominal',), 'dimension', 'open'),
    'Region':      TypeRegistryEntry('Categorical', 'GeoPlace', ('nominal',), 'dimension', 'open'),
    'Address':     TypeRegistryEntry('Categorical', 'GeoPlace', ('nominal',), 'dimension', 'open'),
    'ZipCode':     TypeRegistryEntry('Categorical', 'GeoPlace', ('nominal',), 'identifier', 'open'),
    'Latitude':    TypeRegistryEntry('Measure', 'GeoCoord', ('geographic', 'quantitative'), 'dimension', 'fixed'),
    'Longitude':   TypeRegistryEntry('Measure', 'GeoCoord', ('geographic', 'quantitative'), 'dimension', 'fixed'),
    # --- Categorical ---
    'Category':    TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open'),
    'Boolean':     TypeRegistryEntry('Categorical', 'Status', ('nominal',), 'dimension', 'open'),
    'Status':      TypeRegistryEntry('Categorical', 'Status', ('nominal',), 'dimension', 'open'),
    'Range':       TypeRegistryEntry('Categorical', 'Range', ('ordinal',), 'dimension', 'open'),
    'Direction':   TypeRegistryEntry('Categorical', 'Coded', ('ordinal', 'nominal'), 'dimension', 'cyclic'),
    # --- Identifiers ---
    'Name':        TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open'),
}


def get_registry_entry(semantic_type: str) -> TypeRegistryEntry:
    """Look up a type in the registry. Falls back to UNKNOWN."""
    return TYPE_REGISTRY.get(semantic_type, _UNKNOWN)


def is_registered(semantic_type: str) -> bool:
    return semantic_type in TYPE_REGISTRY


# ---------------------------------------------------------------------------
# §2  Channel Semantics (minimal)
# ---------------------------------------------------------------------------

@dataclass
class ChannelSemantics:
    """Resolved semantic decisions for a single channel."""
    field: str = ''
    semantic_type: str = ''
    vl_type: str = 'nominal'      # quantitative | nominal | ordinal | temporal
    ordinal_sort_order: list[str] | None = None


# ---------------------------------------------------------------------------
# §3  VL Type Resolution
# ---------------------------------------------------------------------------

def resolve_vl_type(semantic_type: str, values: List[Any]) -> str:
    """
    Determine the best VL encoding type for a field.
    Uses semantic type first, then disambiguates with data.
    """
    if not semantic_type or not is_registered(semantic_type):
        return _infer_vl_type_from_data(values)

    entry = get_registry_entry(semantic_type)
    candidates = entry.vis_encodings

    if len(candidates) == 1:
        return candidates[0] if candidates[0] != 'geographic' else 'quantitative'

    # Disambiguate quantitative vs ordinal
    if 'quantitative' in candidates and 'ordinal' in candidates:
        distinct = len(set(v for v in values if v is not None))
        # Guard: if values contain non-integer floats, they are continuous
        # and should be quantitative regardless of cardinality.
        # E.g. Rating values like 1.2, 3.7, 4.1 are clearly continuous.
        nums = [v for v in values if isinstance(v, (int, float))]
        if nums:
            has_fractions = any(v % 1 != 0 for v in nums)
            if has_fractions:
                return 'quantitative'
        return 'ordinal' if distinct <= 12 else 'quantitative'

    # Disambiguate temporal vs ordinal
    if 'temporal' in candidates and 'ordinal' in candidates:
        non_null = [v for v in values if v is not None]
        if non_null and all(isinstance(v, (int, float)) for v in non_null):
            # Pure numeric — check if they look like 4-digit years.
            # When semantic type is Year/Decade and values are 4-digit
            # integers in a plausible year range (1000–2999), use temporal
            # for larger sets so VL gets a continuous time axis.
            # convert_temporal_data will convert int → str("1980") before
            # the data reaches VL, avoiding the unix-ms misinterpretation.
            distinct = len(set(non_null))
            if _looks_like_year_integers(non_null):
                return 'ordinal' if distinct <= 6 else 'temporal'
            # Not year-like integers → ordinal (safe default)
            return 'ordinal' if distinct <= 20 else 'quantitative'
        # Date strings or datetime objects → temporal
        distinct = len(set(v for v in values if v is not None))
        return 'ordinal' if distinct <= 6 else 'temporal'

    # geographic + quantitative
    if 'geographic' in candidates and 'quantitative' in candidates:
        return 'quantitative'

    return candidates[0]


def _looks_like_year_integers(values: List[Any]) -> bool:
    """Check if a list of numeric values look like 4-digit year integers.

    Returns True when >=80% of non-null values are integers in the
    plausible year range 1000-2999.  This is used to decide whether
    integer Year/Decade data should get a temporal axis (with string
    conversion) rather than being treated as plain quantitative numbers.
    """
    nums = [v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    if not nums:
        return False
    year_count = sum(
        1 for v in nums
        if v == int(v) and 1000 <= int(v) <= 2999
    )
    return year_count >= len(nums) * 0.8


def _infer_vl_type_from_data(values: List[Any]) -> str:
    """Infer VL type purely from data values."""
    non_null = [v for v in values if v is not None]
    if not non_null:
        return 'nominal'
    if all(isinstance(v, bool) for v in non_null):
        return 'nominal'

    # Check for native datetime/date objects first
    if all(isinstance(v, (datetime, date)) for v in non_null):
        return 'temporal'

    # Check for pandas Timestamp objects
    try:
        import pandas as pd
        if all(isinstance(v, pd.Timestamp) for v in non_null):
            return 'temporal'
    except ImportError:
        pass

    if all(isinstance(v, (int, float)) for v in non_null):
        # Pure numeric — check for likely timestamps
        if all(_is_likely_timestamp(v) for v in non_null[:20]):
            return 'temporal'
        return 'quantitative'

    # String values — check if they look like dates
    str_vals = [v for v in non_null[:30] if isinstance(v, str)]
    if str_vals and len(str_vals) >= len(non_null[:30]) * 0.8:
        date_count = sum(1 for s in str_vals if _looks_like_date(s))
        if date_count >= len(str_vals) * 0.7:
            return 'temporal'

    return 'nominal'


# ---------------------------------------------------------------------------
# Timestamp detection (mirrors TS isLikelyTimestamp)
# ---------------------------------------------------------------------------

_MAX_TIMESTAMP_SEC = 4102444800       # ~2099-12-31 in epoch seconds
_MAX_TIMESTAMP_MS = 4102444800000     # ~2099-12-31 in epoch milliseconds


def _is_likely_timestamp(val: Any) -> bool:
    """Check if a numeric value is likely a unix timestamp (s or ms)."""
    if not isinstance(val, (int, float)):
        return False
    if isinstance(val, bool):
        return False
    if math.isnan(val) or math.isinf(val):
        return False
    if val >= 1e9 and val <= _MAX_TIMESTAMP_SEC:
        return True
    if val > _MAX_TIMESTAMP_SEC and val <= _MAX_TIMESTAMP_MS:
        return True
    return False


def _timestamp_to_ms(val: float) -> float:
    """Convert seconds-epoch to ms-epoch if needed."""
    return val * 1000 if val <= _MAX_TIMESTAMP_SEC else val


# ---------------------------------------------------------------------------
# Date string detection (mirrors TS looksLikeDateString, much more robust)
# ---------------------------------------------------------------------------

# Pre-compiled patterns for efficiency
_DATE_PATTERNS = [
    # ISO 8601: 2020-01-15, 2020-01-15T12:00:00Z
    re.compile(r'^\d{4}-\d{2}-\d{2}'),
    # Slash-separated: 2020/01/15 or 01/15/2020 or 15/01/2020
    re.compile(r'^\d{1,4}[/]\d{1,2}[/]\d{1,4}$'),
    # Month name variants: Jan 2020, January 2020, Jan-2020, 2020-Jan
    re.compile(r'^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[\s,.-]+\d', re.I),
    re.compile(r'^\d{1,2}[\s,.-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', re.I),
    re.compile(r'^\d{4}[\s,.-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', re.I),
    # Quarter formats: Q1 2020, 2020-Q1, 2020 Q1
    re.compile(r'^Q[1-4][\s,-]+\d{4}$', re.I),
    re.compile(r'^\d{4}[\s,-]*Q[1-4]$', re.I),
    # Dot-separated: 15.01.2020 or 2020.01.15
    re.compile(r'^\d{1,2}\.\d{1,2}\.\d{2,4}$'),
    re.compile(r'^\d{4}\.\d{1,2}\.\d{1,2}$'),
    # Dash-separated with short month: 15-Jan-2020, 2020-01-15
    re.compile(r'^\d{1,2}-\w+-\d{2,4}$'),
    # Year-month: 2020-01, 2020/01
    re.compile(r'^\d{4}[-/]\d{1,2}$'),
    # Month-year: Jan-2020
    re.compile(r'^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[-/]\d{4}$', re.I),
    # Compact: 20200115
    re.compile(r'^\d{8}$'),
]


def _looks_like_date(s: str) -> bool:
    """Check if a string looks like a date/datetime value.

    This is a lightweight heuristic used for type inference.
    Does NOT match bare 4-digit years ("2020") — those should be
    handled via semantic type (Year/Decade) to avoid false positives
    with generic integer IDs.
    """
    t = s.strip()
    if not t:
        return False
    return any(p.search(t) for p in _DATE_PATTERNS)


# ---------------------------------------------------------------------------
# Robust date parsing (try multiple strategies)
# ---------------------------------------------------------------------------

def _try_parse_date(val: Any) -> Optional[datetime]:
    """Try to parse a value as a datetime.  Returns None on failure."""
    if isinstance(val, datetime):
        return val
    if isinstance(val, date) and not isinstance(val, datetime):
        return datetime(val.year, val.month, val.day)
    try:
        import pandas as pd
        if isinstance(val, pd.Timestamp):
            return val.to_pydatetime()
    except ImportError:
        pass

    if isinstance(val, (int, float)):
        if _is_likely_timestamp(val):
            ms = _timestamp_to_ms(val)
            return datetime.utcfromtimestamp(ms / 1000)
        return None

    if isinstance(val, str):
        t = val.strip()
        if not t:
            return None
        # Fast-path ISO
        for fmt in (
            '%Y-%m-%d',
            '%Y-%m-%dT%H:%M:%S',
            '%Y-%m-%dT%H:%M:%SZ',
            '%Y-%m-%dT%H:%M:%S.%f',
            '%Y-%m-%dT%H:%M:%S.%fZ',
            '%m/%d/%Y',
            '%d/%m/%Y',
            '%Y/%m/%d',
            '%b %d, %Y',
            '%B %d, %Y',
            '%d %b %Y',
            '%d %B %Y',
            '%b %Y',
            '%B %Y',
            '%Y-%m',
            '%Y/%m',
        ):
            try:
                return datetime.strptime(t, fmt)
            except ValueError:
                continue
        # Fallback: pandas parser (very flexible)
        try:
            import pandas as pd
            return pd.to_datetime(t).to_pydatetime()
        except Exception:
            pass
    return None


# ---------------------------------------------------------------------------
# §4  Ordinal Sort Order  (months, days, quarters)
# ---------------------------------------------------------------------------

_MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
               'July', 'August', 'September', 'October', 'November', 'December']
_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
_MONTH_NUM = [str(i) for i in range(1, 13)]

_DOW_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
_DOW_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
_DOW_FULL_SUN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
_DOW_ABBR_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

_QUARTER = ['Q1', 'Q2', 'Q3', 'Q4']

_COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
_COMPASS_4 = ['N', 'E', 'S', 'W']

_ORDINAL_SEQUENCES: Dict[str, List[Tuple[List[str], bool]]] = {
    'Month': [(_MONTH_FULL, True), (_MONTH_ABBR, True), (_MONTH_NUM, False)],
    'Day': [(_DOW_FULL, True), (_DOW_ABBR, True), (_DOW_FULL_SUN, True), (_DOW_ABBR_SUN, True)],
    'Quarter': [(_QUARTER, True)],
    'Direction': [(_COMPASS_8, True), (_COMPASS_4, True)],
}


def infer_ordinal_sort_order(semantic_type: str, values: List[Any]) -> list[str] | None:
    """
    Detect canonical ordinal sort order for months, days, quarters, etc.
    Returns sorted unique values in canonical order, or None.
    """
    # Try by explicit semantic type
    sequences = _ORDINAL_SEQUENCES.get(semantic_type)
    if sequences:
        result = _match_sequence(values, sequences)
        if result:
            return result

    # Auto-detect for generic types
    if not semantic_type or semantic_type in ('Category', 'Unknown'):
        for seqs in _ORDINAL_SEQUENCES.values():
            result = _match_sequence(values, seqs)
            if result:
                return result

    return None


def _match_sequence(
    values: List[Any],
    sequences: List[Tuple[List[str], bool]],
) -> list[str] | None:
    unique_vals = list(dict.fromkeys(str(v) for v in values if v is not None))
    if not unique_vals:
        return None

    for labels, case_insensitive in sequences:
        lookup = {(l.lower() if case_insensitive else l): i for i, l in enumerate(labels)}
        matched = []
        unmatched = []
        for val in unique_vals:
            key = val.lower() if case_insensitive else val
            idx = lookup.get(key)
            if idx is not None:
                matched.append((val, idx))
            else:
                unmatched.append(val)

        if len(matched) >= len(unique_vals) * 0.6 and len(matched) >= 2:
            matched.sort(key=lambda x: x[1])
            return [m[0] for m in matched] + unmatched

    return None


# ---------------------------------------------------------------------------
# §5  Temporal Data Conversion  (mirrors TS convertTemporalData)
# ---------------------------------------------------------------------------

def _expand_to_full_year(val: str) -> str:
    """Expand 2-digit year to 4-digit: '98' → '1998', '07' → '2007'."""
    t = val.strip()
    if re.fullmatch(r'\d{2}', t):
        n = int(t)
        return str(2000 + n if n <= 49 else 1900 + n)
    return val


def convert_temporal_data(
    data: List[Dict[str, Any]],
    semantic_types: Dict[str, Any],
    all_values: Dict[str, List[Any]] | None = None,
) -> List[Dict[str, Any]]:
    """
    Convert temporal field values to canonical string representations
    so that Vega-Lite can parse them correctly.

    Mirrors the TS ``convertTemporalData`` function.

    This handles:
    - Year/Decade integers → string ("2015" not 2015, avoids VL unix-ms interpretation)
    - Unix timestamps → ISO datetime strings
    - datetime/date objects → ISO strings
    - pd.Timestamp objects → ISO strings
    - 2-digit year strings → 4-digit
    - Any other temporal values → str()

    Parameters:
    - data: list of row dicts (will be cloned)
    - semantic_types: field_name → semantic type string or annotation dict
    - all_values: optional precomputed {field: [values]} for type inference

    Returns: new list of row dicts with temporal fields converted to strings.
    """
    if not data:
        return data

    import copy

    keys = list(data[0].keys())
    temporal_keys = []

    for k in keys:
        sem_type = _extract_sem_type(semantic_types.get(k))
        # Check semantic type
        if sem_type and is_registered(sem_type):
            entry = get_registry_entry(sem_type)
            if 'temporal' in entry.vis_encodings:
                temporal_keys.append(k)
                continue

        # Check data values
        vals = all_values[k] if all_values and k in all_values else [r.get(k) for r in data[:50]]
        inferred = _infer_vl_type_from_data(vals)
        if inferred == 'temporal':
            temporal_keys.append(k)

    if not temporal_keys:
        return data

    result = copy.deepcopy(data)
    for row in result:
        for k in temporal_keys:
            val = row.get(k)
            if val is None:
                continue
            sem_type = _extract_sem_type(semantic_types.get(k))

            if isinstance(val, (int, float)) and not isinstance(val, bool):
                if sem_type in ('Year', 'Decade'):
                    # Year/Decade: always convert int to string representation
                    row[k] = str(int(val))
                elif _is_likely_timestamp(val):
                    ms = _timestamp_to_ms(val)
                    row[k] = datetime.utcfromtimestamp(ms / 1000).isoformat() + 'Z'
                elif _looks_like_year_integers([val]):
                    # 4-digit year-like integer without explicit Year semantic type
                    # → convert to string so VL doesn't treat it as unix-ms
                    row[k] = str(int(val))
                else:
                    row[k] = str(val)
            elif isinstance(val, datetime):
                row[k] = val.isoformat()
            elif isinstance(val, date) and not isinstance(val, datetime):
                row[k] = val.isoformat()
            else:
                try:
                    import pandas as pd
                    if isinstance(val, pd.Timestamp):
                        row[k] = val.isoformat()
                        continue
                except ImportError:
                    pass
                # String handling
                if isinstance(val, str):
                    if sem_type in ('Year', 'Decade'):
                        row[k] = _expand_to_full_year(val)
                    else:
                        row[k] = str(val)
                else:
                    row[k] = str(val)

    return result


def _extract_sem_type(annotation: Any) -> str:
    """Extract the semantic type string from an annotation (str or dict)."""
    if isinstance(annotation, str):
        return annotation
    if isinstance(annotation, dict):
        return annotation.get('type', annotation.get('semantic_type', ''))
    return ''


# ---------------------------------------------------------------------------
# §6  Full Channel Resolution
# ---------------------------------------------------------------------------

def resolve_channel_semantics(
    field_name: str,
    semantic_type: str,
    channel: str,
    mark_type: str,
    values: List[Any],
    unit: str | None = None,
    intrinsic_domain: tuple[float, float] | None = None,
) -> ChannelSemantics:
    """
    Resolve semantic decisions for one (field, channel) pair.
    This is the main entry point used by create_vl_plots.py.

    Focuses on the critical structural decision: VL type + ordinal sort.
    Formatting, domains, ticks, zero-baseline, color schemes, etc. are
    left to VL defaults (or the front-end TS library).
    """
    vl_type = resolve_vl_type(semantic_type, values)

    cs = ChannelSemantics(
        field=field_name,
        semantic_type=semantic_type,
        vl_type=vl_type,
    )

    # Ordinal sort order (months, days, quarters — affects axis label order)
    if vl_type in ('ordinal', 'nominal'):
        cs.ordinal_sort_order = infer_ordinal_sort_order(semantic_type, values)

    return cs
