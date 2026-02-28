# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
=============================================================================
CHART SEMANTICS — Minimal Python port of the TS agents-chart library
=============================================================================

Ported from:
  src/lib/agents-chart/core/type-registry.ts
  src/lib/agents-chart/core/field-semantics.ts
  src/lib/agents-chart/core/semantic-types.ts
  src/lib/agents-chart/core/resolve-semantics.ts

Provides semantic-aware chart assembly helpers for create_vl_plots.py:
  - Type registry (per-type compilation dimensions)
  - Number formatting  ($, %, unit suffixes, abbreviation)
  - Color scheme selection  (diverging / sequential / categorical)
  - Zero-baseline decisions
  - Domain constraints  (intrinsic domain merging)
  - Ordinal sort order  (months, days, quarters)
  - Temporal format detection
  - Scale type  (log for wide-range data)
  - Tick constraints  (integer-only for counts)

This is NOT a 1:1 port — it's a minimal subset focused on VL spec quality.
The TS library remains the canonical source of truth.
=============================================================================
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

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
    diverging: str         # none | inherent | conditional
    format_class: str      # currency | percent | signed-percent | signed-currency | signed-decimal | unit-suffix | integer | decimal | plain
    zero_baseline: str     # meaningful | arbitrary | contextual | none
    zero_pad: float        # Domain padding for non-zero axes


_UNKNOWN = TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0)

TYPE_REGISTRY: Dict[str, TypeRegistryEntry] = {
    # --- Temporal: DateTime ---
    'DateTime':    TypeRegistryEntry('Temporal', 'DateTime', ('temporal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Date':        TypeRegistryEntry('Temporal', 'DateTime', ('temporal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Time':        TypeRegistryEntry('Temporal', 'DateTime', ('temporal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Timestamp':   TypeRegistryEntry('Temporal', 'DateTime', ('temporal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    # --- Temporal: DateGranule ---
    'Year':        TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open', 'none', 'integer', 'arbitrary', 0.03),
    'Quarter':     TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic', 'none', 'plain', 'none', 0),
    'Month':       TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic', 'none', 'plain', 'arbitrary', 0),
    'Week':        TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic', 'none', 'plain', 'none', 0),
    'Day':         TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic', 'none', 'plain', 'arbitrary', 0),
    'Hour':        TypeRegistryEntry('Temporal', 'DateGranule', ('ordinal',), 'dimension', 'cyclic', 'none', 'integer', 'arbitrary', 0),
    'YearMonth':   TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'YearQuarter': TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'YearWeek':    TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Decade':      TypeRegistryEntry('Temporal', 'DateGranule', ('temporal', 'ordinal'), 'dimension', 'open', 'none', 'integer', 'arbitrary', 0.03),
    # --- Temporal: Duration ---
    'Duration':    TypeRegistryEntry('Temporal', 'Duration', ('quantitative',), 'additive', 'open', 'none', 'unit-suffix', 'meaningful', 0),
    # --- Measure: Amount ---
    'Amount':      TypeRegistryEntry('Measure', 'Amount', ('quantitative',), 'additive', 'open', 'none', 'currency', 'meaningful', 0),
    'Price':       TypeRegistryEntry('Measure', 'Amount', ('quantitative',), 'intensive', 'open', 'none', 'currency', 'meaningful', 0),
    'Revenue':     TypeRegistryEntry('Measure', 'Amount', ('quantitative',), 'additive', 'open', 'none', 'currency', 'meaningful', 0),
    'Cost':        TypeRegistryEntry('Measure', 'Amount', ('quantitative',), 'additive', 'open', 'none', 'currency', 'meaningful', 0),
    # --- Measure: Physical ---
    'Quantity':    TypeRegistryEntry('Measure', 'Physical', ('quantitative',), 'additive', 'open', 'none', 'unit-suffix', 'meaningful', 0),
    'Temperature': TypeRegistryEntry('Measure', 'Physical', ('quantitative',), 'intensive', 'open', 'conditional', 'unit-suffix', 'arbitrary', 0.05),
    # --- Measure: Proportion ---
    'Percentage':  TypeRegistryEntry('Measure', 'Proportion', ('quantitative',), 'intensive', 'bounded', 'none', 'percent', 'contextual', 0),
    # --- Measure: SignedMeasure ---
    'Profit':              TypeRegistryEntry('Measure', 'SignedMeasure', ('quantitative',), 'signed-additive', 'open', 'conditional', 'signed-currency', 'meaningful', 0),
    'PercentageChange':    TypeRegistryEntry('Measure', 'SignedMeasure', ('quantitative',), 'intensive', 'open', 'conditional', 'signed-percent', 'meaningful', 0),
    'Sentiment':           TypeRegistryEntry('Measure', 'SignedMeasure', ('quantitative',), 'intensive', 'open', 'inherent', 'signed-decimal', 'meaningful', 0),
    'Correlation':         TypeRegistryEntry('Measure', 'SignedMeasure', ('quantitative',), 'intensive', 'bounded', 'inherent', 'signed-decimal', 'meaningful', 0),
    # --- Measure: GenericMeasure ---
    'Count':       TypeRegistryEntry('Measure', 'GenericMeasure', ('quantitative',), 'additive', 'open', 'none', 'integer', 'meaningful', 0),
    'Number':      TypeRegistryEntry('Measure', 'GenericMeasure', ('quantitative',), 'additive', 'open', 'none', 'decimal', 'meaningful', 0),
    # --- Discrete ---
    'Rank':        TypeRegistryEntry('Discrete', 'Rank', ('ordinal',), 'dimension', 'open', 'none', 'integer', 'arbitrary', 0.08),
    'Score':       TypeRegistryEntry('Discrete', 'Score', ('quantitative', 'ordinal'), 'intensive', 'bounded', 'conditional', 'decimal', 'contextual', 0.05),
    'Rating':      TypeRegistryEntry('Discrete', 'Score', ('quantitative', 'ordinal'), 'intensive', 'bounded', 'conditional', 'decimal', 'contextual', 0.05),
    'Index':       TypeRegistryEntry('Discrete', 'Index', ('ordinal',), 'dimension', 'open', 'none', 'integer', 'arbitrary', 0.08),
    'ID':          TypeRegistryEntry('Identifier', 'ID', ('nominal',), 'identifier', 'open', 'none', 'plain', 'arbitrary', 0),
    # --- Geographic ---
    'Latitude':    TypeRegistryEntry('Geographic', 'GeoCoordinate', ('quantitative', 'geographic'), 'dimension', 'fixed', 'none', 'decimal', 'arbitrary', 0.02),
    'Longitude':   TypeRegistryEntry('Geographic', 'GeoCoordinate', ('quantitative', 'geographic'), 'dimension', 'fixed', 'none', 'decimal', 'arbitrary', 0.02),
    'Country':     TypeRegistryEntry('Geographic', 'GeoPlace', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'State':       TypeRegistryEntry('Geographic', 'GeoPlace', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'City':        TypeRegistryEntry('Geographic', 'GeoPlace', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Region':      TypeRegistryEntry('Geographic', 'GeoPlace', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Address':     TypeRegistryEntry('Geographic', 'GeoPlace', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'ZipCode':     TypeRegistryEntry('Geographic', 'GeoPlace', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    # --- Categorical: Entity ---
    'PersonName':  TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Company':     TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Product':     TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Category':    TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Name':        TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    # --- Categorical: Coded ---
    'Status':      TypeRegistryEntry('Categorical', 'Coded', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Type':        TypeRegistryEntry('Categorical', 'Coded', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Boolean':     TypeRegistryEntry('Categorical', 'Coded', ('nominal',), 'dimension', 'fixed', 'none', 'plain', 'none', 0),
    'Direction':   TypeRegistryEntry('Categorical', 'Coded', ('ordinal', 'nominal'), 'dimension', 'cyclic', 'none', 'plain', 'none', 0),
    # --- Categorical: Binned ---
    'Range':       TypeRegistryEntry('Categorical', 'Binned', ('ordinal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'AgeGroup':    TypeRegistryEntry('Categorical', 'Binned', ('ordinal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    # --- Fallbacks ---
    'String':      TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
    'Unknown':     TypeRegistryEntry('Categorical', 'Entity', ('nominal',), 'dimension', 'open', 'none', 'plain', 'none', 0),
}


def get_registry_entry(semantic_type: str) -> TypeRegistryEntry:
    """Look up a type in the registry. Falls back to UNKNOWN."""
    return TYPE_REGISTRY.get(semantic_type, _UNKNOWN)


def is_registered(semantic_type: str) -> bool:
    return semantic_type in TYPE_REGISTRY


# ---------------------------------------------------------------------------
# §2  Formatting  (mirrors field-semantics.ts §4)
# ---------------------------------------------------------------------------

CURRENCY_MAP = {
    'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'CNY': '¥',
    'KRW': '₩', 'INR': '₹', 'BRL': 'R$', 'CAD': 'CA$', 'AUD': 'A$',
    'CHF': 'CHF', 'SEK': 'kr', 'NOK': 'kr', 'DKK': 'kr',
}

UNIT_SUFFIX_MAP = {
    '°C': '°C', '°F': '°F', 'K': 'K', 'C': '°C', 'F': '°F',
    'kg': ' kg', 'g': ' g', 'lb': ' lb', 'lbs': ' lbs', 'oz': ' oz',
    'km': ' km', 'mi': ' mi', 'm': ' m', 'ft': ' ft', 'cm': ' cm', 'mm': ' mm',
    'km/h': ' km/h', 'mph': ' mph', 'm/s': ' m/s',
    'sec': ' s', 'min': ' min', 'hr': ' hr', 'day': ' days',
    'seconds': ' s', 'minutes': ' min', 'hours': ' hr', 'days': ' days',
}


@dataclass
class FormatSpec:
    """d3-compatible format specification."""
    pattern: str = ''
    prefix: str = ''
    suffix: str = ''
    abbreviate: bool = False


@dataclass
class DomainConstraint:
    """Domain bounds constraint for a quantitative axis."""
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    clamp: bool = False


@dataclass
class TickConstraint:
    """Tick mark constraint."""
    integers_only: bool = False
    exact_ticks: Optional[List[int]] = None
    min_step: Optional[float] = None


@dataclass
class ZeroDecision:
    """Whether a quantitative axis should include zero."""
    zero: bool = False
    domain_pad_fraction: float = 0.0
    zero_class: str = 'unknown'


@dataclass
class ColorSchemeRecommendation:
    """Recommended color scheme for a channel."""
    scheme: str = 'tableau10'
    type: str = 'categorical'     # 'categorical' | 'sequential' | 'diverging'
    reason: str = ''
    domain_mid: Optional[float] = None


@dataclass
class ChannelSemantics:
    """Resolved semantic decisions for a single channel."""
    field: str = ''
    semantic_type: str = ''
    vl_type: str = 'nominal'      # quantitative | nominal | ordinal | temporal
    format: Optional[FormatSpec] = None
    tooltip_format: Optional[FormatSpec] = None
    zero: Optional[ZeroDecision] = None
    color_scheme: Optional[ColorSchemeRecommendation] = None
    domain_constraint: Optional[DomainConstraint] = None
    tick_constraint: Optional[TickConstraint] = None
    ordinal_sort_order: Optional[List[str]] = None
    temporal_format: Optional[str] = None
    scale_type: Optional[str] = None   # log | sqrt | symlog
    reversed: bool = False



# ---------------------------------------------------------------------------
# §3  Number Format Resolution
# ---------------------------------------------------------------------------

def _detect_precision(values: List[float]) -> int:
    """Detect max meaningful decimal places in data, capped at 4."""
    max_dec = 0
    for v in values:
        if not math.isfinite(v):
            continue
        s = f'{v:.10f}'
        dot = s.index('.')
        end = len(s) - 1
        while end > dot and s[end] == '0':
            end -= 1
        d = end - dot if end > dot else 0
        if d > max_dec:
            max_dec = d
    return min(max_dec, 4)


def _detect_percentage_repr(values: List[float]) -> str:
    """Detect if percentages are 0-1 or 0-100."""
    if not values:
        return '0-100'
    below_1 = sum(1 for v in values if abs(v) <= 1)
    if below_1 / len(values) >= 0.8:
        return '0-1'
    return '0-100'


def _precision_format(values: List[float], use_grouping: bool = True, sign_mode: str = '') -> str:
    p = _detect_precision(values)
    g = ',' if use_grouping else ''
    if p == 0:
        return f'{sign_mode}{g}d'
    return f'{sign_mode}{g}.{p}f'


def resolve_format(
    semantic_type: str,
    unit: Optional[str] = None,
    values: Optional[List[Any]] = None,
) -> Tuple[FormatSpec, Optional[FormatSpec]]:
    """
    Resolve axis format and tooltip format for a field.
    Returns (axis_format, tooltip_format).
    """
    entry = get_registry_entry(semantic_type)
    nums = [v for v in (values or []) if isinstance(v, (int, float)) and math.isfinite(v)]

    currency_prefix = None
    unit_suffix = None
    if unit:
        currency_prefix = CURRENCY_MAP.get(unit.upper()) or CURRENCY_MAP.get(unit)
        unit_suffix = UNIT_SUFFIX_MAP.get(unit) or f' {unit}'

    fc = entry.format_class

    if fc == 'currency':
        pfx = currency_prefix or '$'
        axis_pat = ',.2f' if semantic_type == 'Price' else _precision_format(nums)
        return (
            FormatSpec(pattern=axis_pat, prefix=pfx, abbreviate=True),
            FormatSpec(pattern=',.2f', prefix=pfx),
        )

    if fc == 'signed-currency':
        pfx = currency_prefix or '$'
        return (
            FormatSpec(pattern=_precision_format(nums, True, '+'), prefix=pfx, abbreviate=True),
            FormatSpec(pattern='+,.2f', prefix=pfx),
        )

    if fc == 'percent':
        rep = _detect_percentage_repr(nums)
        if rep == '0-1':
            p = _detect_precision(nums)
            axis_p = max(0, p - 2)
            tip_p = min(axis_p + 1, 4)
            return (
                FormatSpec(pattern=f'.{axis_p}%'),
                FormatSpec(pattern=f'.{tip_p}%'),
            )
        return (
            FormatSpec(pattern=_precision_format(nums, False), suffix='%'),
            FormatSpec(pattern=_precision_format(nums, False), suffix='%'),
        )

    if fc == 'signed-percent':
        rep = _detect_percentage_repr(nums)
        if rep == '0-1':
            p = _detect_precision(nums)
            axis_p = max(0, p - 2)
            tip_p = min(axis_p + 1, 4)
            return (
                FormatSpec(pattern=f'+.{axis_p}%'),
                FormatSpec(pattern=f'+.{tip_p}%'),
            )
        return (
            FormatSpec(pattern=_precision_format(nums, False, '+'), suffix='%'),
            FormatSpec(pattern=_precision_format(nums, False, '+'), suffix='%'),
        )

    if fc == 'signed-decimal':
        return (
            FormatSpec(pattern=_precision_format(nums, False, '+')),
            FormatSpec(pattern=_precision_format(nums, False, '+')),
        )

    if fc == 'unit-suffix':
        sfx = unit_suffix or ''
        return (
            FormatSpec(pattern=_precision_format(nums), suffix=sfx, abbreviate=True),
            FormatSpec(pattern=_precision_format(nums), suffix=sfx),
        )

    if fc == 'integer':
        if semantic_type == 'Year':
            return (FormatSpec(pattern='d'), None)
        return (FormatSpec(pattern=',d'), FormatSpec(pattern=',d'))

    if fc == 'decimal':
        return (FormatSpec(), FormatSpec(pattern=_precision_format(nums)))

    return (FormatSpec(), None)


# ---------------------------------------------------------------------------
# §4  VL Type Resolution  (mirrors semantic-types.ts getVisCategory + field-semantics.ts resolveDefaultVisType)
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
        return 'ordinal' if distinct <= 12 else 'quantitative'

    # Disambiguate temporal vs ordinal
    if 'temporal' in candidates and 'ordinal' in candidates:
        distinct = len(set(v for v in values if v is not None))
        return 'ordinal' if distinct <= 6 else 'temporal'

    # geographic + quantitative
    if 'geographic' in candidates and 'quantitative' in candidates:
        return 'quantitative'

    return candidates[0]


def _infer_vl_type_from_data(values: List[Any]) -> str:
    """Infer VL type purely from data values."""
    non_null = [v for v in values if v is not None]
    if not non_null:
        return 'nominal'
    if all(isinstance(v, bool) for v in non_null):
        return 'nominal'
    if all(isinstance(v, (int, float)) for v in non_null):
        return 'quantitative'
    # Check for dates
    import pandas as pd
    try:
        if all(isinstance(v, str) and _looks_like_date(v) for v in non_null[:20]):
            return 'temporal'
    except Exception:
        pass
    return 'nominal'


def _looks_like_date(s: str) -> bool:
    return bool(re.match(r'^\d|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', s.strip(), re.I))


# ---------------------------------------------------------------------------
# §5  Zero-Baseline Decision  (mirrors semantic-types.ts computeZeroDecision)
# ---------------------------------------------------------------------------

def compute_zero_decision(
    semantic_type: str,
    channel: str,
    mark_type: str,
    values: Optional[List[float]] = None,
) -> ZeroDecision:
    """Compute whether a quantitative axis should include zero."""
    entry = get_registry_entry(semantic_type)
    is_bar_like = mark_type in ('bar', 'area', 'rect')
    zero_class = entry.zero_baseline
    if zero_class == 'none':
        zero_class = 'unknown'

    # Meaningful → always zero
    if zero_class == 'meaningful':
        return ZeroDecision(zero=True, domain_pad_fraction=0, zero_class=zero_class)

    # Arbitrary → no zero (except bar with data crossing zero)
    if zero_class == 'arbitrary':
        if is_bar_like and values:
            if min(values) <= 0:
                return ZeroDecision(zero=True, domain_pad_fraction=0, zero_class=zero_class)
        return ZeroDecision(zero=False, domain_pad_fraction=entry.zero_pad or 0.05, zero_class=zero_class)

    # Contextual → use data range + mark to decide
    if zero_class == 'contextual' and values:
        data_min, data_max = min(values), max(values)
        if data_min <= 0:
            return ZeroDecision(zero=True, domain_pad_fraction=0, zero_class=zero_class)
        proximity = data_min / data_max if data_max > 0 else 0
        if proximity < 0.3:
            return ZeroDecision(zero=True, domain_pad_fraction=0, zero_class=zero_class)
        if is_bar_like:
            return ZeroDecision(zero=True, domain_pad_fraction=0, zero_class=zero_class)
        return ZeroDecision(zero=False, domain_pad_fraction=0.05, zero_class=zero_class)

    # Unknown / fallback
    if is_bar_like and channel in ('x', 'y'):
        return ZeroDecision(zero=True, domain_pad_fraction=0, zero_class='unknown')
    return ZeroDecision(zero=False, domain_pad_fraction=0.05, zero_class='unknown')


# ---------------------------------------------------------------------------
# §6  Domain Constraints  (mirrors field-semantics.ts §9)
# ---------------------------------------------------------------------------

def resolve_domain_constraint(
    semantic_type: str,
    intrinsic_domain: Optional[Tuple[float, float]] = None,
    values: Optional[List[Any]] = None,
) -> Optional[DomainConstraint]:
    """Merge intrinsic domain with data range."""
    nums = [v for v in (values or []) if isinstance(v, (int, float)) and math.isfinite(v)]

    # 1. Explicit intrinsic domain → soft merge
    if intrinsic_domain:
        return _merge_intrinsic(intrinsic_domain, nums, hard=False)

    # 2. Type-intrinsic hard domains
    if semantic_type == 'Latitude':
        return _merge_intrinsic((-90, 90), nums, hard=True)
    if semantic_type == 'Longitude':
        return _merge_intrinsic((-180, 180), nums, hard=True)
    if semantic_type == 'Correlation':
        return _merge_intrinsic((-1, 1), nums, hard=True)

    # 3. Percentage
    if semantic_type == 'Percentage' and nums:
        rep = _detect_percentage_repr(nums)
        intrinsic_max = 1 if rep == '0-1' else 100
        return _merge_intrinsic((0, intrinsic_max), nums, hard=False)

    return None


def _merge_intrinsic(
    intrinsic: Tuple[float, float],
    values: List[float],
    hard: bool,
) -> DomainConstraint:
    if hard:
        return DomainConstraint(min_val=intrinsic[0], max_val=intrinsic[1], clamp=True)
    if not values:
        return DomainConstraint(min_val=intrinsic[0], max_val=intrinsic[1], clamp=False)
    return DomainConstraint(
        min_val=min(intrinsic[0], min(values)),
        max_val=max(intrinsic[1], max(values)),
        clamp=False,
    )


# ---------------------------------------------------------------------------
# §7  Color Scheme  (mirrors semantic-types.ts getRecommendedColorScheme)
# ---------------------------------------------------------------------------

def resolve_color_scheme(
    semantic_type: str,
    vl_type: str,
    unique_count: int = 10,
    values: Optional[List[Any]] = None,
    unit: Optional[str] = None,
    intrinsic_domain: Optional[Tuple[float, float]] = None,
) -> ColorSchemeRecommendation:
    """Pick the best color scheme based on semantic type and data."""
    entry = get_registry_entry(semantic_type)
    nums = [v for v in (values or []) if isinstance(v, (int, float)) and math.isfinite(v)]

    # Determine diverging hint
    is_diverging = _is_diverging(semantic_type, entry, unit, intrinsic_domain, nums)
    div_mid = _diverging_midpoint(semantic_type, entry, unit, intrinsic_domain, nums) if is_diverging else None

    # Temperature
    if semantic_type == 'Temperature':
        if is_diverging:
            return ColorSchemeRecommendation('redblue', 'diverging', 'temperature diverging', div_mid)
        return ColorSchemeRecommendation('reds', 'sequential', 'temperature sequential')

    # Percentage
    if semantic_type == 'Percentage':
        if is_diverging:
            return ColorSchemeRecommendation('redblue', 'diverging', 'percentage diverging', div_mid)
        return ColorSchemeRecommendation('oranges', 'sequential', 'percentage sequential')

    # Financial
    if semantic_type in ('Revenue', 'Price', 'Cost', 'Amount'):
        if is_diverging:
            return ColorSchemeRecommendation('redblue', 'diverging', 'financial diverging', div_mid)
        return ColorSchemeRecommendation('goldgreen', 'sequential', 'financial sequential')

    # Signed measures
    if semantic_type in ('Profit', 'PercentageChange', 'Sentiment', 'Correlation'):
        if is_diverging:
            return ColorSchemeRecommendation('redblue', 'diverging', 'signed measure diverging', div_mid)
        return ColorSchemeRecommendation('viridis', 'sequential', 'signed measure sequential')

    # Score/Rating
    if semantic_type in ('Score', 'Rating'):
        if is_diverging:
            return ColorSchemeRecommendation('redblue', 'diverging', 'score diverging', div_mid)
        return ColorSchemeRecommendation('yelloworangebrown', 'sequential', 'score sequential')

    # Rank
    if semantic_type in ('Rank', 'Index'):
        return ColorSchemeRecommendation('purples', 'sequential', 'rank sequential')

    # Ranges
    if semantic_type in ('AgeGroup', 'Range'):
        return ColorSchemeRecommendation('blues', 'sequential', 'range sequential')

    # Temporal granules
    if semantic_type in ('Year', 'Quarter', 'Month', 'Week', 'Day', 'Hour', 'Decade'):
        return ColorSchemeRecommendation('viridis', 'sequential', 'temporal sequential')

    # Geographic
    if entry.t1 == 'GeoPlace':
        return ColorSchemeRecommendation(
            'tableau20' if unique_count > 10 else 'set2',
            'categorical', 'geographic categorical',
        )

    # Status/Boolean
    if semantic_type in ('Status', 'Boolean'):
        return ColorSchemeRecommendation('set1', 'categorical', 'status categorical')

    # Category/Type
    if semantic_type in ('Category', 'Type'):
        return ColorSchemeRecommendation(
            'tableau20' if unique_count > 10 else 'tableau10',
            'categorical', 'categorical',
        )

    # Companies/Products
    if semantic_type in ('Company', 'Product'):
        return ColorSchemeRecommendation(
            'tableau20' if unique_count > 10 else 'paired',
            'categorical', 'entity categorical',
        )

    # Names
    if semantic_type in ('Name', 'PersonName'):
        return ColorSchemeRecommendation(
            'tableau20' if unique_count > 8 else 'set2',
            'categorical', 'name categorical',
        )

    # Duration
    if semantic_type == 'Duration':
        return ColorSchemeRecommendation('oranges', 'sequential', 'duration sequential')

    # Generic measures
    if entry.agg_role in ('additive', 'intensive', 'signed-additive'):
        if is_diverging:
            return ColorSchemeRecommendation('redblue', 'diverging', 'measure diverging', div_mid)
        return ColorSchemeRecommendation('viridis', 'sequential', 'measure sequential')

    # Default by VL type
    if vl_type == 'quantitative':
        return ColorSchemeRecommendation('viridis', 'sequential', 'default sequential')
    if vl_type == 'ordinal':
        return ColorSchemeRecommendation('blues', 'sequential', 'default ordinal sequential')
    return ColorSchemeRecommendation(
        'tableau20' if unique_count > 10 else 'tableau10',
        'categorical', 'default categorical',
    )


def _is_diverging(
    semantic_type: str,
    entry: TypeRegistryEntry,
    unit: Optional[str],
    intrinsic_domain: Optional[Tuple[float, float]],
    nums: List[float],
) -> bool:
    """Check if field should use diverging color scheme."""
    # Temperature with known unit
    if semantic_type == 'Temperature' and unit:
        unit_mids = {'°C': 0, '°F': 32, 'K': 273.15, 'C': 0, 'F': 32}
        mid = unit_mids.get(unit)
        if mid is not None and nums:
            lo, hi = min(nums), max(nums)
            return lo < mid < hi

    # Inherent diverging always → yes if data spans both sides
    if entry.diverging == 'inherent' and nums:
        return min(nums) < 0 < max(nums)

    # Conditional diverging → only when data spans zero
    if entry.diverging == 'conditional' and nums:
        return min(nums) < 0 < max(nums)

    # Domain-derived midpoint → data spans it
    if intrinsic_domain and nums:
        mid = (intrinsic_domain[0] + intrinsic_domain[1]) / 2
        return min(nums) < mid < max(nums)

    # Data-driven: spans zero
    if nums and min(nums) < 0 < max(nums):
        return True

    return False


def _diverging_midpoint(
    semantic_type: str,
    entry: TypeRegistryEntry,
    unit: Optional[str],
    intrinsic_domain: Optional[Tuple[float, float]],
    nums: List[float],
) -> Optional[float]:
    """Compute diverging midpoint."""
    # Temperature unit
    if semantic_type == 'Temperature' and unit:
        unit_mids = {'°C': 0, '°F': 32, 'K': 273.15, 'C': 0, 'F': 32}
        mid = unit_mids.get(unit)
        if mid is not None:
            return mid

    # Inherent/conditional → 0
    if entry.diverging in ('inherent', 'conditional'):
        return 0

    # Domain midpoint
    if intrinsic_domain:
        return (intrinsic_domain[0] + intrinsic_domain[1]) / 2

    # Data spans 0
    if nums and min(nums) < 0 < max(nums):
        return 0

    return None


# ---------------------------------------------------------------------------
# §8  Ordinal Sort Order  (mirrors semantic-types.ts inferOrdinalSortOrder)
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


def infer_ordinal_sort_order(semantic_type: str, values: List[Any]) -> Optional[List[str]]:
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
    if not semantic_type or semantic_type in ('Category', 'String', 'Unknown'):
        for seqs in _ORDINAL_SEQUENCES.values():
            result = _match_sequence(values, seqs)
            if result:
                return result

    return None


def _match_sequence(
    values: List[Any],
    sequences: List[Tuple[List[str], bool]],
) -> Optional[List[str]]:
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
# §9  Temporal Format  (mirrors resolve-semantics.ts resolveTemporalFormat)
# ---------------------------------------------------------------------------

_SEMANTIC_LEVEL = {
    'Year': 5, 'Decade': 5,
    'YearMonth': 4, 'Month': 4, 'YearQuarter': 4, 'Quarter': 4,
    'Date': 3, 'Day': 3,
    'Hour': 2,
    'DateTime': 1,
    'Timestamp': 0,
}


def resolve_temporal_format(semantic_type: str, values: List[Any]) -> Optional[str]:
    """
    Resolve the best temporal format string (d3 timeFormat) for a field.
    """
    from datetime import datetime
    dates = []
    non_null = 0
    for v in values[:100]:
        if v is None:
            continue
        non_null += 1
        try:
            if isinstance(v, datetime):
                dates.append(v)
            elif isinstance(v, str) and _looks_like_date(v):
                import dateutil.parser
                dates.append(dateutil.parser.parse(v))
        except Exception:
            pass

    if len(dates) < 2 or len(dates) < non_null * 0.5:
        return None

    # Analyze which components vary
    months = set(d.month for d in dates)
    days = set(d.day for d in dates)
    hours = set(d.hour for d in dates)
    minutes = set(d.minute for d in dates)
    seconds = set(d.second for d in dates)
    years = set(d.year for d in dates)

    same = {
        'month': len(months) == 1,
        'day': len(days) == 1,
        'hour': len(hours) <= 2,
        'minute': len(minutes) == 1,
        'second': len(seconds) == 1,
    }
    same_year = len(years) == 1
    same_month = same_year and same['month']
    same_day = same_month and same['day']

    # Compute votes (same as TS)
    votes = [0] * 6
    if same['second']:
        votes[5] += 1; votes[4] += 1; votes[3] += 1; votes[2] += 1; votes[1] += 1
    if same['minute'] and same['second']:
        votes[5] += 1; votes[4] += 1; votes[3] += 1; votes[2] += 1
    if same['hour'] and same['minute'] and same['second']:
        votes[5] += 1; votes[4] += 1; votes[3] += 1
    if same['day'] and same['hour'] and same['minute'] and same['second']:
        votes[5] += 2; votes[4] += 2
    if same['month'] and same['day'] and same['hour'] and same['minute'] and same['second']:
        votes[5] += 3
    if not same['month'] and same['day'] and same['hour'] and same['minute'] and same['second']:
        votes[4] += 3
    if not same['day'] and same['hour'] and same['minute'] and same['second']:
        votes[3] += 3
    if not same['hour'] and same['minute'] and same['second']:
        votes[2] += 3
    if not same['minute'] and same['second']:
        votes[1] += 3
    if not same['second']:
        votes[0] += 4

    # Semantic type bias
    sem_level = _SEMANTIC_LEVEL.get(semantic_type)
    if sem_level is not None:
        votes[sem_level] += 3

    # Pick best level
    best_level = max(range(6), key=lambda i: votes[i])

    # Level → format
    fmt_map = {
        5: '%Y',
        4: '%b' if same_year else '%b %Y',
        3: '%b %d' if same_year else '%b %d, %Y',
        2: '%H:00' if same_day else '%b %d %H:00',
        1: '%H:%M' if same_day else '%b %d %H:%M',
        0: '%H:%M:%S' if same_day else '%b %d %H:%M:%S',
    }
    return fmt_map.get(best_level)


# ---------------------------------------------------------------------------
# §10  Scale Type  (mirrors field-semantics.ts resolveScaleType)
# ---------------------------------------------------------------------------

def resolve_scale_type(semantic_type: str, values: List[float]) -> Optional[str]:
    """Recommend log scale for wide-range additive measures."""
    entry = get_registry_entry(semantic_type)
    if not (entry.agg_role == 'additive' and entry.domain_shape == 'open'):
        return None
    if len(values) < 10:
        return None
    nums = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    if len(nums) < 10:
        return None
    if min(nums) < 0:
        return None
    if max(nums) <= 0:
        return None
    pos_min = min(v for v in nums if v > 0)
    if max(nums) / pos_min >= 10000:
        return 'log'
    return None


# ---------------------------------------------------------------------------
# §11  Tick Constraints  (mirrors field-semantics.ts §10)
# ---------------------------------------------------------------------------

def resolve_tick_constraint(
    semantic_type: str,
    intrinsic_domain: Optional[Tuple[float, float]] = None,
) -> Optional[TickConstraint]:
    entry = get_registry_entry(semantic_type)

    if entry.format_class == 'integer':
        tc = TickConstraint(integers_only=True, min_step=1)
        if intrinsic_domain:
            span = intrinsic_domain[1] - intrinsic_domain[0]
            if 0 < span <= 20:
                tc.exact_ticks = list(range(int(intrinsic_domain[0]), int(intrinsic_domain[1]) + 1))
        return tc

    if semantic_type in ('Score', 'Rating') and intrinsic_domain:
        span = intrinsic_domain[1] - intrinsic_domain[0]
        tc = TickConstraint(integers_only=True, min_step=1)
        if 0 < span <= 20:
            tc.exact_ticks = list(range(int(intrinsic_domain[0]), int(intrinsic_domain[1]) + 1))
        return tc

    return None


# ---------------------------------------------------------------------------
# §12  Reversed Axis  (mirrors field-semantics.ts §12)
# ---------------------------------------------------------------------------

def resolve_reversed(semantic_type: str) -> bool:
    return semantic_type == 'Rank'


# ---------------------------------------------------------------------------
# §14  Full Channel Resolution
# ---------------------------------------------------------------------------

def resolve_channel_semantics(
    field_name: str,
    semantic_type: str,
    channel: str,
    mark_type: str,
    values: List[Any],
    unit: Optional[str] = None,
    intrinsic_domain: Optional[Tuple[float, float]] = None,
) -> ChannelSemantics:
    """
    Resolve all semantic decisions for one (field, channel) pair.
    This is the main entry point used by create_vl_plots.py.
    """
    vl_type = resolve_vl_type(semantic_type, values)
    axis_fmt, tooltip_fmt = resolve_format(semantic_type, unit, values)

    cs = ChannelSemantics(
        field=field_name,
        semantic_type=semantic_type,
        vl_type=vl_type,
        format=axis_fmt if axis_fmt and axis_fmt.pattern else None,
        tooltip_format=tooltip_fmt,
    )

    # Numeric values for downstream decisions
    nums = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]

    # Zero baseline (positional quantitative only)
    if channel in ('x', 'y') and vl_type == 'quantitative' and nums:
        cs.zero = compute_zero_decision(semantic_type, channel, mark_type, nums)

    # Domain constraint
    cs.domain_constraint = resolve_domain_constraint(semantic_type, intrinsic_domain, values)

    # Color scheme (color channel)
    if channel in ('color', 'group'):
        unique_count = len(set(v for v in values if v is not None))
        cs.color_scheme = resolve_color_scheme(
            semantic_type, vl_type, unique_count, values, unit, intrinsic_domain,
        )

    # Tick constraint
    cs.tick_constraint = resolve_tick_constraint(semantic_type, intrinsic_domain)

    # Ordinal sort order
    if vl_type in ('ordinal', 'nominal'):
        cs.ordinal_sort_order = infer_ordinal_sort_order(semantic_type, values)

    # Temporal format
    if vl_type == 'temporal':
        cs.temporal_format = resolve_temporal_format(semantic_type, values)

    # Scale type
    if vl_type == 'quantitative' and nums:
        cs.scale_type = resolve_scale_type(semantic_type, nums)

    # Reversed
    cs.reversed = resolve_reversed(semantic_type)


    return cs
