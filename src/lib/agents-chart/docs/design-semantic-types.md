# Design: Semantic Type System

This document describes the semantic type hierarchy, how types map to visualization categories (VL encoding types), and how semantic types can inform axis domain decisions — particularly **whether a continuous axis should start at zero**.

---

# §1 Semantic Type Hierarchy

## Overview

Semantic types classify data fields beyond raw data type (string/number/date). A column named "Revenue" isn't just a number — it's a monetary measure that should be quantitative, zero-based, and use financial color schemes. A column named "Year" isn't just a number — it's a temporal granule that should be ordinal or temporal, never zero-based (year 0 is meaningless).

The type system is defined in `semantic-types.ts`. Types are plain strings for easy serialization and flexible matching.

## The lattice

```
                           ┌─────────────┐
                           │   AnyType   │
                           └──────┬──────┘
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
     ┌──────────┐         ┌──────────┐         ┌──────────┐
     │ Temporal │         │ Numeric  │         │Categorical│
     └────┬─────┘         └────┬─────┘         └─────┬────┘
          │                    │                     │
    ┌─────┴─────┐        ┌─────┴─────┐         ┌─────┴─────┐
    │           │        │           │         │           │
  Point     Granule    Measure   Discrete    Entity     Coded
    │           │        │           │         │           │
 DateTime    Year     Quantity    Rank      Person     Status
 Date        Month    Count       Index     Company    Boolean
 Time        Day      Price       Score     Product    Category
             Quarter  Percentage  Rating    Location
             Decade   Amount      ID
                      Revenue
                      Cost
                      Rate
                      Ratio
                      Distance
                      Temperature
                      Weight
                      Speed
                      ...
```

### Branch descriptions

| Branch | Examples | Nature | Key property |
|---|---|---|---|
| **Temporal Point** | DateTime, Date, Time, Timestamp | Full-precision time values | Naturally ordered along a timeline |
| **Temporal Granule** | Year, Month, Quarter, Day, Hour | Discrete time units | Ordered but cyclic (months wrap) or sequential (years don't) |
| **Measure** | Quantity, Count, Price, Revenue, Percentage, Temperature | True continuous values | Aggregable (sum, mean). The core quantitative branch. |
| **Discrete Numeric** | Rank, Index, ID, Score, Rating, Level | Numbers with ordinal/identifier semantics | NOT aggregable (mean of ranks is meaningless) |
| **Entity** | PersonName, Company, Product, Location, Country | Named things | Nominal — no inherent order |
| **Coded** | Status, Boolean, Category, Type | Classification labels | Nominal, usually small cardinality |
| **Range/Binned** | Range, AgeGroup, Bucket | Discretized continuous values | Ordinal — have inherent order from the underlying continuum |
| **Geographic** | Latitude, Longitude, Country, City | Spatial data | Either coordinate (quantitative) or named location (nominal) |

---

# §2 Mapping to Visualization Categories (VisCategory)

Each semantic type maps to one of five visualization categories, which in turn determine the Vega-Lite encoding type:

| VisCategory | VL encoding type | Meaning |
|---|---|---|
| `quantitative` | `quantitative` | Continuous numeric — linear/log scale, aggregable |
| `ordinal` | `ordinal` | Ordered discrete — ordered bands or ticks |
| `nominal` | `nominal` | Unordered discrete — independent categories |
| `temporal` | `temporal` | Time — VL parses and formats as dates |
| `geographic` | `quantitative` (*) | Lat/lon coordinates — quantitative but with map semantics |

(*) Geographic coordinates map to `quantitative` for VL encoding but carry special semantics (map projections, paired axes).

## Complete mapping table

| Semantic type | VisCategory | Rationale |
|---|---|---|
| **Temporal points** | | |
| DateTime, Date, Time, Timestamp | `temporal` | Full-precision time axis |
| YearMonth, YearQuarter, YearWeek | `temporal` | Compound temporal — VL parses correctly |
| Year | `temporal` | Sequential years on a timeline (*) |
| **Temporal granules** | | |
| Quarter, Month, Week, Day, Hour, Decade | `ordinal` | Ordered but not a continuous timeline |
| TimeRange | `ordinal` | Ordered intervals |
| **Measures** | | |
| Quantity, Count, Amount, Price, Revenue, Cost | `quantitative` | Core measures |
| Percentage, Rate, Ratio | `quantitative` | Proportional measures |
| Distance, Area, Volume, Weight, Temperature, Speed | `quantitative` | Physical measures |
| Duration | `quantitative` | Time span as a number |
| Number (fallback) | `quantitative` | Unknown numeric |
| **Discrete numerics** | | |
| Rank, Index, Level | `ordinal` | Ordered positions — not aggregable |
| Score, Rating | `quantitative` | Quasi-continuous evaluations (**) |
| ID | `nominal` | Identifier — no order or aggregation |
| **Entities** | | |
| Name, PersonName, Username, Email | `nominal` | Unordered named things |
| Company, Brand, Department, Product, Category | `nominal` | Organizational entities |
| SKU | `nominal` | Product identifier |
| **Geographic** | | |
| Latitude, Longitude, Coordinates | `geographic` | Numeric coordinates |
| Location, Country, State, City, Region, Address, ZipCode | `nominal` | Named places |
| **Coded** | | |
| Status, Type, Boolean, Binary, Code | `nominal` | Classification labels |
| **Ranges** | | |
| Range, AgeGroup, Bucket | `ordinal` | Discretized continuum — ordered bins |
| **Fallbacks** | | |
| String | `nominal` | Unknown string |
| Unknown | `nominal` | Untyped |

(*) **Year as temporal vs. ordinal:** Year maps to `temporal` because years like 2020, 2021, 2022 parse correctly on a VL temporal axis and maintain proportional spacing (a gap from 1990 to 2020 is visually wider than 2020 to 2022). The `resolveEncodingType` function validates that values actually parse as temporal before committing.

(**) **Score/Rating as quantitative:** Unlike Rank (which is purely positional), Score and Rating represent quasi-continuous evaluations where arithmetic is meaningful (average score = 4.2). They map to quantitative so they can be used as continuous axes and aggregated.

## Channel-specific overrides

The mapping above gives the **default** VL type. Some channels override:

| Channel | Override | Reason |
|---|---|---|
| `color` (temporal) | → `ordinal` if ≤12 unique values | Color legend is clearer with discrete swatches |
| `size` (temporal) | → `ordinal` | Size encoding needs discrete steps |
| `column`, `row` (temporal) | → `ordinal` | Facets are always discrete panels |
| Any (ordinal, high cardinality + fractional) | → `quantitative` | Guard against mis-classified measures (e.g., "Index" assigned to a field with dense floats) |

These overrides happen in `resolveEncodingType()` in `assemble.ts`.

---

# §3 Zero-Based Axis Decision

## The problem

When a quantitative axis displays data, should the scale domain start at 0 or at (near) the data minimum?

This is one of the most consequential layout decisions:

- **Zero-based:** The axis includes 0, even if all data values are far from it (e.g., temperatures 60–90°F). This can waste canvas space on empty range but preserves proportional length encoding.
- **Data-fitted:** The axis starts near `min(data)`. This maximizes visual discrimination between values but can exaggerate small differences.

Vega-Lite defaults:
- **Quantitative positional axes (x, y):** `scale.zero = true` for aggregate/bar marks, `scale.zero = false` for point/line marks.
- **Size channel:** `scale.zero = true` (always).

### The current gap

The assembler currently does **not** make a semantic-type-driven zero decision. It relies on VL defaults, which are mark-driven. This misses cases where the **meaning of the data** should drive the decision:

| Scenario | VL default | Correct behavior |
|---|---|---|
| Bar chart of Revenue | zero = true | Correct — revenue bars should start at 0 |
| Scatter plot of Revenue vs. Cost | zero = false | Wrong — financial scatter should be zero-based; truncating hides proportionality |
| Scatter plot of Temperature vs. Humidity | zero = false | Correct — temperature has no meaningful zero in this context (°F/°C) |
| Line chart of Year vs. Rank | zero = false | Correct — rank 0 doesn't exist |
| Line chart of Year vs. Percentage | zero = false | Depends — 0–100% range is natural; if data is 45–55%, zero-based shows context |

## Semantic types as the decision signal

The key insight: **whether a zero baseline is meaningful depends on what the number represents, not what mark draws it.** Semantic types encode exactly this information.

### Classification: zero-meaningful vs. zero-arbitrary

**Zero-meaningful types** — 0 has a real-world interpretation. Comparisons to zero and ratios between values are meaningful. Truncating the axis hides important context.

| Type | Why zero matters | Example |
|---|---|---|
| Count | 0 = nothing counted | Bar chart of event counts |
| Amount, Revenue, Cost, Price | 0 = no money | Revenue comparison across products |
| Quantity | 0 = absence of the measured thing | Inventory levels |
| Percentage, Rate, Ratio | 0 = none; 1.0 or 100% = all | Completion rates |
| Distance, Area, Volume, Weight | 0 = zero extent/mass | Package weights |
| Duration | 0 = instant | Response times |
| Speed | 0 = stationary | Vehicle speeds |

**Zero-arbitrary types** — 0 is either meaningless, doesn't exist, or is an arbitrary reference point. The data's range is what matters.

| Type | Why zero doesn't matter | Example |
|---|---|---|
| Temperature | 0°F and 0°C are arbitrary; ratio comparisons wrong | Weather scatter plot |
| Year | Year 0 doesn't exist; distance from 0 is meaningless | Timeline |
| Score, Rating | Often 1-based (1–5 stars); 0 may not be in the scale | Product ratings |
| Rank, Index | Position-based; 0th place doesn't exist | Leaderboard |
| Latitude, Longitude | 0°N is arbitrary (equator); ratio is meaningless | Map coordinates |
| ID | Identifier, not a quantity | — |
| Level | Often 1-based discrete steps | Game levels |

**Context-dependent types** — the answer depends on the data range or the chart type.

| Type | Zero-based when... | Data-fitted when... |
|---|---|---|
| Percentage | Data spans a wide range (0–80%) | Data is tightly clustered (48–52%) — zooming in shows variation |
| Score | Scale includes 0 (0–100) | Scale is high-based (85–100) — differences matter more than absolute |
| Temperature | Showing energy/physics context (absolute scale) | Showing weather/human context (relative differences) |

### Proposed decision function

The function takes semantic type, mark type, channel, and **data values** (when available). It returns a `ZeroDecision` that includes not just the boolean but also domain padding instructions for non-zero axes.

```typescript
interface ZeroDecision {
    zero: boolean;
    /** 
     * For non-zero axes: how much to pad the domain beyond
     * [min, max] so edge values aren't crushed against the axis.
     * Expressed as a fraction of data range.
     * e.g. 0.05 = 5% padding on each side.
     */
    domainPadFraction: number;
    /** The zero class that drove this decision */
    zeroClass: ZeroClass | 'unknown';
}
```

> **Note:** The pseudocode below omits `zeroClass` from return values for
> brevity. The real implementation includes it in every `ZeroDecision`.

#### Step 1: Classify the semantic type

```typescript
const zeroMeaningful = new Set([
    'Count', 'Amount', 'Revenue', 'Cost', 'Price',
    'Quantity', 'Distance', 'Area', 'Volume', 'Weight',
    'Duration', 'Speed',
    'Number',  // fallback assumes measure
]);

const zeroArbitrary = new Set([
    'Temperature', 'Year',
    'Rank', 'Index', 'Level',
    'ID',
    'Latitude', 'Longitude',
    'Decade', 'Month', 'Day', 'Hour',
]);

// These types have meaningful zeros but may benefit from data-fitting
// when data is concentrated far from zero and mark is not bar/area.
const zeroContextual = new Set([
    'Percentage', 'Rate', 'Ratio',
    'Score', 'Rating',
]);
```

#### Step 2: Use mark type to set the strength of the zero preference

| Mark | Zero pull | Rationale |
|---|---|---|
| **bar, area, rect** | Strong | Length/area from baseline *is* the encoding — truncation is a visual lie |
| **rule, tick** | Moderate | Reference lines/marks; zero-baseline usually appropriate |
| **line** | Weak | Position encoding; trends matter more than distance from zero |
| **point, circle, square** | Weak | Position encoding; spread improves discrimination |
| **text** | None | No visual encoding to distort |

#### Step 3: Use data to disambiguate contextual types

For types in `zeroContextual` (Percentage, Rate, Ratio, Score, Rating), inspect the actual data range:

```
dataMin = min(values)
dataMax = max(values)

// How close is the data to zero, relative to its own range?
proximity = dataMin / dataMax   (when dataMax > 0 and dataMin ≥ 0)
```

| Condition | Decision | Rationale |
|---|---|---|
| `dataMin ≤ 0` | `zero: true` | Data already touches/crosses zero — show it |
| `proximity < 0.3` | `zero: true` | Data starts close to zero (e.g., Percentage 0–80%) — zero is natural floor |
| `proximity ≥ 0.3` + bar/area mark | `zero: true` | Bar length integrity overrides — even if data is 40–80%, bars need zero |
| `proximity ≥ 0.3` + other marks | `zero: false` | Data is far from zero (e.g., Score 85–100) — zoom in to show variation |

The 0.3 threshold means: if the bottom 30% of the axis would be empty void, data-fitting is worth it (for non-bar marks). Below 0.3, the zero baseline provides useful context without wasting too much space.

#### Step 4: Domain padding for non-zero axes

When `zero: false`, the axis domain is `[dataMin, dataMax]`. Edge values (especially the minimum) sit right on the axis boundary, making them hard to read — labels overlap the axis, points touch the frame, rank #1 appears glued to the edge.

**Solution:** Extend the domain by a small fraction on each side.

```
padding = (dataMax - dataMin) * domainPadFraction
axisDomain = [dataMin - padding, dataMax + padding]
```

The padding fraction depends on the semantic type and how "hard" the domain boundaries are:

| Semantic type | `domainPadFraction` | Rationale |
|---|---|---|
| **Rank, Index, Level** | 0.08 (≈ half a rank unit for small N) | 1-based values; need breathing room but rank 0 shouldn't appear as a tick |
| **Score, Rating** | 0.05 | Enough room for edge labels |
| **Year, Decade** | 0.03 | Small padding; years are dense and contextual |
| **Temperature** | 0.05 | Standard padding |
| **Latitude, Longitude** | 0.02 | Maps need tight framing |
| **Default** | 0.05 | Safe general-purpose padding |

For **Rank specifically**: with N=20 ranks, range = 19, padding = 19 × 0.08 ≈ 1.5. Axis domain becomes [−0.5, 21.5]. Rank 1 has breathing room; rank 0 doesn't appear as a labeled tick (VL's `nice` might round to 0, but with explicit domain VL respects it). The axis labels show 2, 4, 6, ... 20 — no misleading 0.

#### Complete decision logic

```typescript
function computeZeroDecision(
    semanticType: string,
    channel: string,
    markType: string,
    values?: number[]
): ZeroDecision {
    const isBarLike = ['bar', 'area', 'rect'].includes(markType);
    const isPositional = ['x', 'y'].includes(channel);

    // --- Zero-meaningful types: always zero (semantic signal is strong) ---
    if (zeroMeaningful.has(semanticType)) {
        return { zero: true, domainPadFraction: 0 };
    }

    // --- Zero-arbitrary types: never zero, apply padding ---
    if (zeroArbitrary.has(semanticType)) {
        // Exception: bar/area marks still get zero for zero-arbitrary
        // ONLY if data actually includes 0 or negative values.
        if (isBarLike && values && values.length > 0) {
            const dataMin = Math.min(...values);
            if (dataMin <= 0) {
                return { zero: true, domainPadFraction: 0 };
            }
        }

        const padMap: Record<string, number> = {
            Rank: 0.08, Index: 0.08, Level: 0.08,
            Score: 0.05, Rating: 0.05,
            Year: 0.03, Decade: 0.03,
            Temperature: 0.05,
            Latitude: 0.02, Longitude: 0.02,
        };
        return {
            zero: false,
            domainPadFraction: padMap[semanticType] ?? 0.05,
        };
    }

    // --- Contextual types: use data range + mark to decide ---
    if (zeroContextual.has(semanticType) && values && values.length > 0) {
        const dataMin = Math.min(...values);
        const dataMax = Math.max(...values);

        // Data touches/crosses zero → include it
        if (dataMin <= 0) {
            return { zero: true, domainPadFraction: 0 };
        }

        // How far is data from zero?
        const proximity = dataMax > 0 ? dataMin / dataMax : 0;

        // Close to zero → include it
        if (proximity < 0.3) {
            return { zero: true, domainPadFraction: 0 };
        }

        // Far from zero + bar/area → still include (bar integrity)
        if (isBarLike) {
            return { zero: true, domainPadFraction: 0 };
        }

        // Far from zero + non-bar → data-fit with padding
        return { zero: false, domainPadFraction: 0.05 };
    }

    // --- No semantic type or unrecognized → no opinion, let VL decide ---
    // Return VL's mark-based default
    if (isBarLike && isPositional) {
        return { zero: true, domainPadFraction: 0 };
    }
    return { zero: false, domainPadFraction: 0.05 };
}
```

### Truth table: all combinations

| Semantic class | Mark type | Data range | `zero` | Pad | Example |
|---|---|---|---|---|---|
| **Meaningful** (Revenue) | bar | any | true | 0 | Revenue bars from 0 |
| **Meaningful** (Count) | line | any | true | 0 | Event count line from 0 |
| **Meaningful** (Quantity) | scatter | any | true | 0 | Inventory scatter from 0 |
| **Arbitrary** (Temperature) | bar | all > 0 | false | 0.05 | Temperature bars — no 0°F baseline |
| **Arbitrary** (Temperature) | bar | has ≤ 0 | true | 0 | Temperature bars crossing 0°C — show the crossing |
| **Arbitrary** (Rank) | line | [1, 20] | false | 0.08 | Rank line: axis [−0.5, 21.5], rank 1 breathes |
| **Arbitrary** (Year) | line | [2010, 2025] | false | 0.03 | Year axis: [2009.5, 2025.5] |
| **Arbitrary** (Latitude) | scatter | [30, 50] | false | 0.02 | Map: tight framing |
| **Contextual** (Percentage) | bar | [0, 80%] | true | 0 | Percentage bars from 0 |
| **Contextual** (Percentage) | scatter | [45%, 55%] | false | 0.05 | Zoomed scatter on narrow range |
| **Contextual** (Percentage) | bar | [45%, 55%] | true | 0 | Even narrow range: bar integrity |
| **Contextual** (Score) | line | [85, 100] | false | 0.05 | Score line: zoom to show variation |
| **Contextual** (Score) | bar | [85, 100] | true | 0 | Score bars: show full magnitude |
| **Contextual** (Rating) | scatter | [1, 5] | true | 0 | 1-based but starts near 0 (proximity = 0.2 < 0.3) |
| **None** (unknown) | bar | any | true | 0 | VL default for bars |
| **None** (unknown) | scatter | any | false | 0.05 | VL default for scatter |

### Edge cases

**Rank 1 on a line chart.** Without padding, rank 1 sits on the axis frame. With `domainPadFraction = 0.08`:
- Data range [1, 20], span = 19.
- Padding = 19 × 0.08 ≈ 1.5.
- Axis domain = [−0.5, 21.5].
- Rank 1 is at relative position 1.5/22 ≈ 7% from the bottom — enough breathing room.
- VL tick marks: 2, 4, 6, ..., 20 (or 5, 10, 15, 20). No misleading "0" label.

**Rank 1 on a bump chart (Y axis, inverted).** Same padding applies. Axis domain [−0.5, 21.5] with `scale.reverse = true`. Rank 1 appears near the top with room above it.

**Revenue bar chart, data 500K–900K.** Semantic type = Revenue → `zeroMeaningful` → `zero: true`. Axis goes [0, 900K]. The bottom 56% of bars are "free" — they show how large the revenue really is. No padding needed; 0 is the natural baseline.

**Temperature bar chart, data 60–90°F.** Semantic type = Temperature → `zeroArbitrary`. Data min = 60, all > 0. Override even VL's bar default → `zero: false`, pad = 0.05. Axis domain ≈ [58.5, 91.5]. Bars show temperature *differences*, not distance from 0°F.

**Percentage scatter, data 0.1%–95%.** Semantic type = Percentage → `zeroContextual`. proximity = 0.1/95 ≈ 0.001 < 0.3 → `zero: true`. The data nearly touches zero, so including it costs nothing and provides the natural floor.

**Percentage scatter, data 48%–52%.** proximity = 48/52 ≈ 0.92 ≥ 0.3, not bar → `zero: false`, pad = 0.05. Zooms in to show the 4-percentage-point spread clearly.

### Interaction with mark type

Mark type adds a **secondary** signal that modulates the semantic decision:

| Mark | Effect on zero decision | Reason |
|---|---|---|
| **Bar** | Strongly prefer zero | Bar length *is* the visual encoding — truncating it is a lie |
| **Area** | Strongly prefer zero | Filled area from baseline; non-zero baseline misrepresents magnitude |
| **Line** | Weakly prefer data-fitted | Position encoding; local trends matter more than distance from zero |
| **Point/Circle** | Weakly prefer data-fitted | Position encoding; maximizing spread improves discrimination |
| **Rect/Heatmap** | Neutral (color encodes, not position) | Axis range affects density but not the value encoding |

**Priority: semantic type > mark type > data range > VL default.**

A Revenue scatter plot should be zero-based even though VL defaults scatter to `zero: false`, because semantic meaning outranks mark-type convention. Conversely, a Temperature bar chart should NOT be zero-based even though VL defaults bars to `zero: true`, because 0°F is arbitrary.

### Domain padding implementation

For non-zero axes, the padding is computed as a pure function (no mutation)
and the caller applies it to the VL spec:

```typescript
/**
 * Compute padded domain bounds for a non-zero axis.
 * Pure computation — returns [paddedMin, paddedMax] without modifying any spec.
 */
function computePaddedDomain(
    values: number[],
    padFraction: number,
): [number, number] | null {
    if (padFraction <= 0 || values.length < 2) return null;

    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const span = dataMax - dataMin;
    if (span <= 0) return null;

    const padding = span * padFraction;
    return [dataMin - padding, dataMax + padding];
}
```

The caller applies the result to the encoding:

```typescript
const padded = computePaddedDomain(values, decision.domainPadFraction);
if (padded) {
    encoding.scale = { ...encoding.scale, domain: padded, nice: false, zero: false };
}
```

Setting `nice: false` is critical — otherwise VL may round the domain to "nice" numbers that re-introduce 0 (e.g., domain [−0.5, 21.5] might get "niced" to [0, 25]).

### Interaction with axis compression (§2 of design-stretch-model.md)

The zero-based decision interacts with the per-axis stretch model:

1. **A zero-based axis with data far from zero compresses the data range.** If Revenue ranges 500K–900K but the axis goes 0–900K, the data occupies only the top 44% of the axis. The per-axis stretch model counts unique pixel positions in that compressed range — since all data maps to ~44% of the pixels, the effective density is higher than if the axis were data-fitted.

2. **This is usually correct behavior.** For zero-meaningful types (Revenue, Count), the zero baseline is semantically important and the data-fitted region is genuinely denser. If the positional stretch detects that density and stretches the axis slightly, that's appropriate.

3. **When it might over-stretch:** A zero-based bar chart with data far from zero (e.g., Revenue 500K–900K) won't trigger positional stretch because bar charts use the spring model for their discrete axis. The continuous axis (Y) only stretches if series-count pressure demands it.

### Worked example

**Setup:** Bar chart of Revenue. 20 products. Revenue ranges 500K–900K. Canvas 400×320.

**Without semantic type awareness:**
- VL default for bar: `zero = true`. Axis goes 0–900K.
- Data occupies the top 44% of the Y axis.
- Per-axis stretch model sees compressed pixel positions but this is a bar chart, so Y uses spring model (discrete) or series-count (stacked), not positional pixel counting.

**With semantic type awareness:**
- Semantic type = `Revenue` → `zeroMeaningful` → confirm `zero = true`.
- No change to stretch behavior — the semantic type confirms the VL default was correct.
- The chart stays at natural size.

---

# §4 Summary

## Type system architecture

```
Semantic Type (string)
    ↓  getVisCategory()
VisCategory: quantitative | ordinal | nominal | temporal | geographic
    ↓  resolveEncodingType()
VL encoding type: quantitative | ordinal | nominal | temporal
    ↓  computeZeroDecision(semanticType, channel, mark, data)
ZeroDecision: { zero, domainPadFraction, zeroClass }
    ↓  computePaddedDomain()
scale.zero + scale.domain
```

## Decision tables

### Semantic type → VisCategory (simplified)

| Semantic branch | VisCategory | Example types |
|---|---|---|
| Temporal Point | temporal | DateTime, Date, Year |
| Temporal Granule | ordinal | Month, Quarter, Day |
| Measure | quantitative | Quantity, Count, Price, Revenue, Temperature |
| Discrete Numeric | ordinal / nominal | Rank, Index, ID |
| Entity | nominal | Person, Company, Product |
| Coded | nominal | Status, Boolean, Category |
| Range | ordinal | AgeGroup, Bucket |
| Geographic Coord | geographic | Latitude, Longitude |
| Geographic Name | nominal | Country, City |

### Semantic type → Zero baseline

| Zero class | Signal | Types | Bar/Area mark | Other marks |
|---|---|---|---|---|
| **Meaningful** | 0 = absence | Count, Revenue, Quantity, Distance, ... | `zero: true` | `zero: true` |
| **Arbitrary** | 0 = nonexistent | Rank, Year, Temperature, Lat/Lon | `zero: false` + pad (*) | `zero: false` + pad |
| **Contextual** | Depends on range | Percentage, Score, Rating | `zero: true` (bar integrity) | `zero: true` if proximity < 0.3, else `zero: false` + pad |
| **Unknown** | No semantic info | — | `zero: true` (VL default) | `zero: false` + pad (VL default) |

(*) Exception: if data crosses/touches 0, show it (`zero: true`) regardless of semantic class.

### Domain padding by type

| Type | Pad fraction | Axis example (data [1, 20]) |
|---|---|---|
| Rank, Index, Level | 0.08 | [−0.5, 21.5] |
| Score, Rating | 0.05 | [0.05, 20.95] |
| Year, Decade | 0.03 | [2009.4, 2025.6] |
| Temperature | 0.05 | [58.5, 91.5] |
| Latitude, Longitude | 0.02 | [29.6, 50.4] |
| Default | 0.05 | — |

### Impact on axis compression

The zero decision affects which data range the per-axis stretch model sees.
For zero-based axes, the scale domain extends to 0, which affects pixel-position
bucketing. For data-fitted axes, the domain matches the data range closely.
