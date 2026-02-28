# Design: Semantic-Type-Driven Compilation Context

> **Status:** Draft — for discussion and revision  
> **Date:** 2026-02-27  
> **Scope:** Redesign the semantic type system to produce a structured per-field compilation context that drives all visualization property decisions  
> **Related:** `design-semantic-types.md` (current system), `semantic-types.ts`, `resolve-semantics.ts`, `decisions.ts`

---

## §0 Semantic Type Inventory

### 0.1 Tiered type system: resolution levels

Having 80+ fine-grained types is powerful but impractical for every scenario. Different tasks warrant different levels of type specificity. We organize semantic types into **three tiers** so the LLM can annotate at the level of detail appropriate for the cost/quality tradeoff:

| Tier | Count | Purpose | LLM cost | Viz config quality |
|---|---|---|---|---|
| **T0 — Family** | 7 | Coarsest. Enough to pick encoding type (Q/O/N/T) and basic defaults | Lowest — can even be rule-based without LLM | Correct encoding, generic formatting |
| **T1 — Category** | 16 | Mid-level. Enough for format prefix/suffix, aggregation default, zero-baseline, color scheme class | Moderate — small closed list, high accuracy | Good formatting, sensible defaults |
| **T2 — Specific** | ~40 | Finest. Enables diverging midpoints, domain constraints, tick strategies, interpolation hints | Higher — larger vocabulary, needs examples | Full compilation context |

**The key design principle:** the compilation logic works at any tier. If the LLM provides `"Revenue"` (T2), we get everything: `$` prefix, sum aggregation, meaningful zero, sequential color, log-scale hint. If it provides `"Amount"` (T1), we still get `$` prefix, sum, meaningful zero — but miss the log-scale hint. If it provides `"Measure"` (T0), we get quantitative encoding, sum aggregation, meaningful zero — but no format prefix. **Graceful degradation, not failure.**

### 0.2 Tier 0 — Families (~7 types)

These are the broadest categories. They map directly to visualization encoding logic and can be inferred by simple heuristics (no LLM needed):

| T0 Family | Data type | Default vis encoding | What it determines |
|---|---|---|---|
| **Temporal** | date/string | temporal | Time axis, date parsing, temporal sort |
| **Measure** | number | quantitative | Numeric axis, aggregation=sum, meaningful zero |
| **Discrete** | number | ordinal | Integer ticks, no aggregation, arbitrary zero |
| **Geographic** | number/string | geographic/nominal | Map layer, geocoding |
| **Categorical** | string | nominal | Color/shape/facet, no axis ordering |
| **Ordinal** | string | ordinal | Ordered categories, canonical sort |
| **Identifier** | number/string | nominal | Tooltip only, never encode on axis/color |

**What T0 alone gives you:** correct encoding type, basic aggregation default, zero-baseline class, which channels are appropriate (you wouldn't put a Categorical on Y for a bar chart). This is roughly what a simple rule-based system (no LLM) could produce from data type + cardinality + column-name heuristics.

**What T0 misses:** format prefix/suffix, specific aggregation (sum vs avg), diverging detection, domain constraints, scale type hints, interpolation.

### 0.3 Tier 1 — Categories (~25 types)

Mid-level types within each family. Each T1 type maps to exactly one T0 family. The LLM picks from a manageable list and gets high accuracy.

| T0 Family | T1 Categories | What T1 adds over T0 |
|---|---|---|
| **Temporal** | `DateTime`, `DateGranule`, `Duration` | Point-in-time vs granule (month/year) vs time span; determines temporal parse, ordinal-vs-temporal encoding |
| **Measure** | `Amount`, `Physical`, `Proportion`, `SignedMeasure`, `GenericMeasure` | Format prefix/suffix class ($, %, °), aggregation (sum vs avg), diverging detection |
| **Discrete** | `Rank`, `Score`, `Index` | Reversed axis (Rank), integer ticks, domain hints |
| **Geographic** | `GeoCoordinate`, `GeoPlace` | Lat/lon pairing vs geocodable name; map layer type |
| **Categorical** | `Entity`, `Coded`, `Binned` | Cardinality expectations, ordinal-ness of binned values |
| **Ordinal** | (most ordinals are DateGranule or Binned — see above) | |
| **Identifier** | `ID` | Never aggregate, never encode |

**Full T1 type table:**

| T1 Type | T0 Family | Vis encoding | What it determines |
|---|---|---|---|
| `DateTime` | Temporal | temporal | Full date/time parsing, temporal axis |
| `DateGranule` | Temporal | ordinal or temporal | Month/Year/Quarter/etc. — ordinal sort, built-in canonical order |
| `Duration` | Temporal | quantitative | Time span, "2h 30m" formatting, sum/avg aggregation |
| `Amount` | Measure | quantitative | Currency prefix ($, €), sum aggregation, meaningful zero |
| `Physical` | Measure | quantitative | Unit suffix (kg, km, °C, mph), avg aggregation, arbitrary zero for Temperature |
| `Proportion` | Measure | quantitative | % or ratio formatting, bounded domain [0,1] or [0,100], avg aggregation |
| `SignedMeasure` | Measure | quantitative | Diverging midpoint (0), signed data, conditional/inherent diverging color |
| `GenericMeasure` | Measure | quantitative | No special format, sum/avg heuristic from field name |
| `Rank` | Discrete | ordinal | Reversed axis, integer ticks, not aggregable |
| `Score` | Discrete | quantitative | Bounded domain, integer ticks, avg aggregation |
| `Index` | Discrete | ordinal/nominal | Row number, sequence — not aggregable, not for axis |
| `GeoCoordinate` | Geographic | quantitative | Fixed domain (lat [-90,90], lon [-180,180]), map projection |
| `GeoPlace` | Geographic | nominal | Geocodable name, choropleth/symbol-map |
| `Entity` | Categorical | nominal | High cardinality expected, tooltip-friendly |
| `Coded` | Categorical | nominal | Low cardinality, discrete colors, legend-friendly. Includes Status, Type, Boolean, Direction |
| `Binned` | Categorical | ordinal | Pre-binned ranges ("18-24"), ordinal axis, sequential color |
| `ID` | Identifier | nominal | Never aggregate, tooltip only |

**What T1 alone gives you:** correct encoding, format class (currency/percent/unit/plain), aggregation default (sum vs avg), zero-baseline class, diverging detection, domain shape (bounded/open/fixed/cyclic).

**What T1 misses:** specific format symbol ($€£¥ vs just "currency"), exact domain bounds, unit-specific formatting (°C vs °F), type-specific interpolation hints. Diverging midpoints for domain-specific scales (like pH=7) are derived from `intrinsicDomain` or type-intrinsic logic rather than T2 types.

### 0.4 Tier 2 — Specific types (~40 types)

The full vocabulary. Each T2 type maps to exactly one T1 category. These provide the finest-grained compilation context.

The T2 inventory is deliberately **pruned to types that change compilation behavior** vs. their T1 parent. Types that compile identically to a sibling are dropped — the LLM can use the T1 name instead. Domain-specific diverging midpoints (e.g., pH=7, NPS=0) are derived from the `intrinsicDomain` midpoint or type-intrinsic logic rather than dedicated T2 types.

| T1 Category | T2 Specific Types |
|---|---|
| `DateTime` | DateTime, Date, Time, Timestamp |
| `DateGranule` | Year, Quarter, Month, Day, Hour, YearMonth, YearQuarter, YearWeek, Decade |
| `Duration` | Duration |
| `Amount` | Amount, Price, Revenue, Cost |
| `Physical` | Quantity, Temperature |
| `Proportion` | Percentage |
| `SignedMeasure` | Profit, PercentageChange, Sentiment, Correlation |
| `GenericMeasure` | Count, Number |
| `Rank` | Rank |
| `Score` | Score, Rating |
| `Index` | Index |
| `GeoCoordinate` | Latitude, Longitude |
| `GeoPlace` | Country, State, City, Region, ZipCode, Address |
| `Entity` | PersonName, Company, Product, Category, Name |
| `Coded` | Status, Type, Boolean, Direction |
| `Binned` | Range, AgeGroup |
| `ID` | ID |

**What was dropped and why:**

> **Implementation note:** These types are fully removed from both the
> `TYPE_REGISTRY` (field-semantics.ts) and the `SemanticTypes` constant
> (semantic-types.ts). If the LLM produces a dropped type string, it will
> hit the `UNKNOWN_ENTRY` fallback (Categorical/Entity/nominal). The LLM
> prompt should be updated to only offer the "Use instead" types.

| Dropped T2 | Use instead | Rationale |
|---|---|---|
| TimeRange | Duration | Same compilation (ordinal encoding) |
| Distance, Area, Volume, Weight, Speed | Quantity (or `Physical` T1) | Unit captured by annotation; same `unit-suffix` format class |
| Rate | Percentage | Same format + aggregation |
| Ratio | Number (via `decimal` format) | Open domain, no percent scaling |
| Level | Score | Same compilation (bounded, avg, integer) |
| Coordinates | Latitude + Longitude | Ambiguous pair; use specific coordinate types |
| Location | Country / State / City | Generic fallback; same compilation |
| Username, Email, Brand, Department | PersonName / Company / Name | Same nominal compilation |
| Binary, Code | Boolean / Status | Same categorical compilation |
| Bucket | Range | Same compilation |
| SKU | ID | Same compilation (identifier role) |

**What T2 adds over T1:**
- `Revenue` vs `Price` → both `Amount`, but Revenue is `measure-sum` (totals) while Price is `measure-avg` (per-unit); `Cost` kept for LLM annotation clarity (compiles like Revenue)
- `Temperature` vs `Quantity` → both `Physical`, but Temperature has conditional diverging (freezing-point midpoint from unit); Quantity is generic with no diverging
- `Month` vs `Year` vs `Quarter` → all `DateGranule`, but Month has cyclic(12) domain, Quarter has cyclic(4), Year is open-ended
- `Sentiment` vs `Profit` vs `Correlation` → all `SignedMeasure`, but Sentiment is inherently diverging, Profit is conditionally diverging, Correlation has fixed domain [-1,1]

### 0.5 The hierarchy as a DAG

```
T0 Family         T1 Category          T2 Specific
─────────         ───────────          ──────────────────────

Temporal ─────┬── DateTime ──────────── DateTime, Date, Time, Timestamp
              ├── DateGranule ───────── Year, Quarter, Month, Day, Hour,
              │                         YearMonth, YearQuarter, YearWeek, Decade
              └── Duration ─────────── Duration

Measure ──────┬── Amount ────────────── Amount, Price, Revenue, Cost
              ├── Physical ─────────── Quantity, Temperature
              ├── Proportion ────────── Percentage
              ├── SignedMeasure ─────── Profit, PercentageChange, Sentiment, Correlation
              └── GenericMeasure ────── Count, Number

Discrete ─────┬── Rank ─────────────── Rank
              ├── Score ────────────── Score, Rating
              └── Index ────────────── Index

Geographic ───┬── GeoCoordinate ────── Latitude, Longitude
              └── GeoPlace ─────────── Country, State, City, Region, ZipCode, Address

Categorical ──┬── Entity ───────────── PersonName, Company, Product, Category, Name
              ├── Coded ────────────── Status, Type, Boolean, Direction
              └── Binned ───────────── Range, AgeGroup

Identifier ───┴── ID ───────────────── ID
```

**Resolution logic:** The builder function `resolveFieldSemantics()` resolves the tier of the provided type and applies progressively more specific logic:

```typescript
function resolveFieldSemantics(annotation, fieldName, values) {
    const { semanticType } = normalizeAnnotation(annotation);

    // Resolve tier membership
    const t2 = T2_REGISTRY[semanticType];   // e.g., { t1: 'Amount', t0: 'Measure', ... }
    const t1 = t2?.t1 ?? T1_REGISTRY[semanticType];  // maybe the input IS a T1 type
    const t0 = t1?.t0 ?? T0_REGISTRY[semanticType];  // maybe the input IS a T0 type

    // T0 decisions (always available)
    const encoding = resolveEncoding(t0, values);
    const aggRole  = resolveAggRole(t0);
    const zeroClass = resolveZeroClass_T0(t0);

    // T1 decisions (available if T1 or finer)
    const formatClass = t1 ? resolveFormatClass(t1) : null;
    const aggDefault  = t1 ? resolveAggDefault(t1) : resolveAggDefault_fromT0(t0);
    const diverging   = t1 ? resolveDivergingClass(t1) : null;

    // T2 decisions (available if T2)
    const formatDetail = t2 ? resolveFormatDetail(t2, annotation) : null;
    const domainHint   = t2 ? resolveDomainHint(t2, annotation, values) : null;
    const tickHint     = t2 ? resolveTickHint(t2, annotation) : null;
    const interpolation = t2 ? resolveInterpolation(t2) : null;

    // Merge: finer overrides coarser, nulls fall back
    return mergeContext(t0Defaults, t1Refinements, t2Specifics);
}
```

### 0.6 LLM annotation strategies

The tiered system enables different annotation strategies depending on the task:

| Strategy | Types used | When to use | LLM prompt size |
|---|---|---|---|
| **Full T2** | All specific types | High-value dashboards, one-time setup | Largest (~40 types in prompt) |
| **T1 only** | Category-level only | Bulk dataset annotation, cost-sensitive | Medium (~16 types) |
| **T0 only** | Family-level only | Quick preview, rule-based fallback | Smallest (~7 types), may not need LLM |
| **Mixed** | T2 for key fields, T1 for rest | Typical interactive session | Adaptive prompt |

**Mixed strategy example:**

The LLM is given a dataset with 20 columns. The user is building a revenue chart, so the system asks for T2 annotation on the 3-4 likely chart fields (revenue, month, category) and T1 for the remaining 16 columns:

```json
{
    "revenue": { "semantic_type": "Revenue", "unit": "USD" },
    "month":   { "semantic_type": "Month" },
    "product_category": { "semantic_type": "Coded" },
    "customer_name":    { "semantic_type": "Entity" },
    "customer_age":     { "semantic_type": "GenericMeasure" },
    "region":           { "semantic_type": "GeoPlace" },
    "order_date":       { "semantic_type": "DateTime" },
    "satisfaction":     { "semantic_type": "Score", "domain": [1, 5] }
}
```

Here `revenue`, `month`, and `satisfaction` get T2 types (fine-grained decisions). `product_category` and `customer_name` get T1 (enough for encoding and format class). When the user later drags `customer_age` onto a chart, the system can re-annotate that one field at T2 level.

### 0.7 Multi-membership dimensions: orthogonal axes that drive visualization

The tier hierarchy (T0→T1→T2) is ONE axis of the type system — it controls *which* compilation rules fire and at what granularity. But every semantic type also sits at a specific position along several **orthogonal classification dimensions**, each of which directly controls a distinct set of visualization properties. The compilation context is the *product* of tier-derived decisions **and** dimension-derived decisions.

#### 0.7.1 The five orthogonal dimensions

| Dimension | Values | What viz properties it controls |
|---|---|---|
| **Vis encoding candidates** | `quantitative`, `ordinal`, `nominal`, `temporal` (one or more, with preference order) | Axis type, scale type, mark compatibility, channel compatibility, sort |
| **Aggregation role** | `measure-sum`, `measure-avg`, `dimension`, `identifier` | Whether to aggregate, which aggregate function, whether to group-by, tooltip-only |
| **Domain shape** | `open`, `bounded`, `fixed`, `cyclic` | Scale domain clamping, tick generation, extrapolation, axis extent, radar/polar recommendation |
| **Diverging nature** | `none`, `conditional`, `inherent` | Color scheme class (sequential vs diverging), midpoint, legend center, bipolar axis |
| **Format class** | `currency`, `percent`, `unit-suffix`, `date`, `time`, `integer`, `plain` | Axis label format, tooltip format, prefix/suffix, decimal precision |

These dimensions are NOT derivable from the tier hierarchy alone — they are properties of each type that must be explicitly catalogued. Two types in the same T1 category can differ on multiple dimensions (e.g., `Temperature` and `Weight` are both `Physical` but differ on diverging nature).

#### 0.7.2 Dimension → Visualization property mapping

Each dimension controls a specific, non-overlapping set of downstream visualization decisions:

**Vis encoding candidates** → determines:
- Whether a field can go on X/Y axis (quantitative/temporal/ordinal) vs only color/shape/facet (nominal)
- Scale type: `linear`, `log`, `time`, `point`, `band`
- Compatible mark types: quantitative fields → line/area/bar; nominal → bar/point; temporal → line/area
- Sort behavior: temporal → chronological; ordinal → canonical order; nominal → data order or alphabetical
- When a type has multiple valid encodings (e.g., `Rating` → Q or O), the builder picks based on chart type + channel: scatter Y → quantitative; heatmap color → ordinal

**Aggregation role** → determines:
- Whether the field appears in the `aggregate` vs `groupby` clause
- Default aggregate function: `measure-sum` → `"sum"`, `measure-avg` → `"mean"`
- Whether the field should be offered as a measure or dimension in the UI
- `identifier` → excluded from aggregation entirely, tooltip-only

**Domain shape** → determines:
- Scale domain: `open` → auto from data; `bounded` → clamp to known range; `fixed` → hard limits; `cyclic` → modular
- Tick generation: `bounded [0,100]` → nice ticks within range; `fixed [-90,90]` → constrained; `cyclic` → all cycle values
- Extrapolation: `cyclic` → no extrapolation beyond period; `open` → allow forecast extension
- Chart type hints: `cyclic` → radar/polar natural; `bounded` → gauge natural
- Axis padding: `bounded` → don't pad beyond bounds; `open` → allow padding
- Color interpolation: `cyclic` → wrap-around palette; `bounded` → clamp at edges

**Diverging nature** → determines:
- Color scheme: `none` → sequential; `conditional` → sequential by default, diverging if data spans both sides; `inherent` → always diverging
- Midpoint: `inherent` → fixed center (0 for Profit, 0 for Sentiment); `conditional` → 0 if data crosses zero; `none` → N/A
- Domain-specific midpoints (e.g., pH=7, NPS=0, custom satisfaction scales) are derived from `annotation.intrinsicDomain` midpoint rather than type-intrinsic logic
- Legend symmetry: diverging → symmetric around midpoint; sequential → start at min
- Reference line: diverging → draw reference at midpoint; sequential → no reference

**Format class** → determines:
- Axis label format string: `currency` → `$,.2f`; `percent` → `.1%`; `unit-suffix` → `,.1f kg`
- Tooltip format: same prefix/suffix, possibly more precision
- Number precision: `currency` → 2 decimal; `percent` → 1 decimal; `integer` → 0 decimal
- Prefix/suffix: `currency` → prefix ($, €, £); `unit-suffix` → suffix (kg, km, °C); `percent` → suffix (%)

#### 0.7.3 Complete multi-membership table

Every type occupies a position in the tier hierarchy AND a position along each orthogonal dimension. This table shows both:

| Type (T2) | T1 | T0 | Vis encoding (pref order) | Agg role | Domain | Diverging | Format |
|---|---|---|---|---|---|---|---|
| Month | DateGranule | Temporal | ordinal, temporal | dimension | cyclic (12) | none | date |
| Year | DateGranule | Temporal | temporal, ordinal | dimension | open | none | integer |
| Rating | Score | Discrete | quantitative, ordinal | measure-avg | bounded [1,N] | conditional | integer |
| Temperature | Physical | Measure | quantitative | measure-avg | open | conditional | unit-suffix |
| Quantity | Physical | Measure | quantitative | measure-avg | open, ≥0 | none | unit-suffix |
| Sentiment | SignedMeasure | Measure | quantitative | measure-avg | bounded [-1,1] | inherent | plain |
| Correlation | SignedMeasure | Measure | quantitative | measure-avg | bounded [-1,1] | inherent | plain |
| Profit | SignedMeasure | Measure | quantitative | measure-sum | open | conditional | currency |
| PercentageChange | SignedMeasure | Measure | quantitative | measure-avg | open | conditional | percent |
| Revenue | Amount | Measure | quantitative | measure-sum | open, ≥0 | none | currency |
| Price | Amount | Measure | quantitative | measure-avg | open, ≥0 | none | currency |
| Percentage | Proportion | Measure | quantitative | measure-avg | bounded [0,1] or [0,100] (data-inferred) | none | percent |
| Count | GenericMeasure | Measure | quantitative | measure-sum | open, ≥0 | none | integer |
| Country | GeoPlace | Geographic | nominal | dimension | open | none | plain |
| Latitude | GeoCoordinate | Geographic | quantitative | dimension | fixed [-90,90] | none | plain |
| ZipCode | GeoPlace | Geographic | nominal (NOT quant!) | dimension | open | none | plain |
| AgeGroup | Binned | Categorical | ordinal | dimension | bounded | none | plain |
| Duration | Duration | Temporal | quantitative | measure-sum | open, ≥0 | none | time |
| Rank | Rank | Discrete | ordinal | dimension | open | none | integer |
| Status | Coded | Categorical | nominal | dimension | fixed | none | plain |
| Direction | Coded | Categorical | nominal | dimension | cyclic (8/16) | none | plain |
| Boolean | Coded | Categorical | nominal | dimension | fixed (2) | none | plain |

#### 0.7.4 How the builder uses both axes

The compilation logic queries **two independent sources** to produce the `FieldSemantics`:

```
                          ┌─────────── Tier hierarchy ───────────┐
                          │  T0: encoding type, basic defaults    │
                          │  T1: format class, agg default, zero  │
                          │  T2: specific format, interpolation   │
                          └──────────────┬───────────────────────┘
                                         │
                                         ▼
                              ┌── FieldSemantics ──┐
                              │  encoding, format, aggregate │
                              │  domain, scale, color, ticks │
                              │  zero, diverging, sort, ...  │
                              └──────────────▲──────────────┘
                                         │
                          ┌──────────────┴───────────────────────┐
                          │  Orthogonal dimensions                │
                          │  Vis candidates → encoding resolution │
                          │  Agg role → aggregate function        │
                          │  Domain shape → scale domain, ticks   │
                          │  Diverging → color, midpoint, ref     │
                          │  Format class → label format          │
                          └──────────────────────────────────────┘
```

The tier hierarchy provides **progressive refinement** (more detail at finer tiers). The orthogonal dimensions provide **cross-cutting properties** that apply regardless of tier. Both are stored in the type registry:

```typescript
// Each type in the registry carries BOTH its tier position AND its dimension values
interface TypeRegistryEntry {
    // Tier position
    tier: 'T0' | 'T1' | 'T2';
    parent?: string;           // T2→T1 or T1→T0 parent

    // Orthogonal dimensions (these drive viz properties directly)
    visEncodings: VisEncoding[];         // preference-ordered, e.g., ['quantitative', 'ordinal']
    aggRole: 'measure-sum' | 'measure-avg' | 'dimension' | 'identifier';
    domainShape: 'open' | 'bounded' | 'fixed' | 'cyclic';
    diverging: 'none' | 'conditional' | 'inherent';
    formatClass: 'currency' | 'percent' | 'unit-suffix' | 'date' | 'time' | 'integer' | 'plain';

    // Optional refinements (T2-level specifics)
    domainBounds?: [number, number];     // e.g., [-90, 90] for Latitude
    cyclePeriod?: number;                // e.g., 12 for Month
    reversedAxis?: boolean;              // e.g., true for Rank
}
```

When a type is recognized at T1 level, the builder inherits the T1 entry's dimension values. When recognized at T2, the T2 entry's values override. When only T0 is known, the builder uses conservative defaults for each dimension (e.g., `visEncodings: ['quantitative']` for Measure, `domainShape: 'open'`, `diverging: 'none'`).

#### 0.7.5 Key design consequences

1. **Vis encoding is not 1:1 with semantic type.** `Month` can be ordinal (bar chart categories) or temporal (time-series X). `Rating` can be quantitative (scatter Y) or ordinal (heatmap). The `visEncodings` array provides a *preference order* that the builder resolves based on chart type and channel. This is a first-class property of the type, not an afterthought.

2. **Domain shape directly determines scale and tick behavior.** Both `Percentage` (T1: Proportion) and `Latitude` (T1: GeoCoordinate) have bounded domains but are in completely different T0 families. The builder queries `domainShape` independently of the tier — same logic applies to both.

3. **Diverging nature directly determines color scheme.** This is not just a T2-level detail — it's an orthogonal dimension that T1 types can carry too. `SignedMeasure` (T1) carries diverging information; `Physical` (T1) is conditionally diverging (only `Temperature` within it, at T2 level). Domain-specific diverging midpoints (e.g., pH=7) are derived from `intrinsicDomain` midpoint rather than dedicated types.

4. **Aggregation role determines aggregate function — and auto-aggregation.** `Revenue` and `Price` are both `Amount` (T1), but Revenue is `measure-sum` while Price is `measure-avg`. This distinction lives in the orthogonal dimension, not in the tier hierarchy. Critically, the aggregation role is essential for **auto-aggregation in under-specified charts**: when a user creates a bar chart with X=`Month` and Y=`Revenue` but provides no color encoding, the dataset likely has multiple rows per month (e.g., per-product or per-region rows). Without explicit color to distinguish them, the system must auto-aggregate Y. Knowing Revenue is `measure-sum` lets the instantiator emit `{"aggregate": "sum", "field": "Revenue"}` automatically. The same applies to line charts — multiple Y values per X point produce a jagged, unreadable line unless aggregated. The correct aggregate function (sum vs mean vs count) depends entirely on the field's aggregation role: Revenue→sum, Temperature→mean, row-count→count. Getting this wrong (e.g., summing temperatures) produces nonsensical charts. Auto-aggregation should be a **compiler option** — an explicit flag the caller passes to the instantiation phase, since some contexts (e.g., raw data preview, user explicitly wanting per-row marks) should suppress it:

    ```typescript
    interface CompilerOptions {
        autoAggregate: boolean;   // when true, instantiator injects aggregate transforms
                                  // for measure fields when multiple rows map to the same
                                  // positional encoding (e.g., same X in a bar/line chart)
        // ... other compiler options ...
    }
    ```

5. **The `FieldSemantics` is the resolved product of both axes.** Downstream code never reasons about tiers or dimensions directly — it gets a fully resolved context where encoding, format, aggregation, domain, diverging, etc. are all concrete values.

#### 0.7.6 Intrinsic vs. data-dependent dimension values

The dimension values in the type registry (§0.7.3, §0.7.4) are **intrinsic** — they reflect the type's nature independent of any specific dataset or chart. But some dimension values are only fully determined when combined with **actual data characteristics**: cardinality, distribution, range, null rate, etc.

**Examples of data-dependent shifts:**

| Intrinsic (from type) | Data signal | Effective (after data) | Reason |
|---|---|---|---|
| `Coded` → vis: nominal | Cardinality > 20 | Treat as quantitative or use top-N + "Other" | Too many categories → cluttered legend/axis |
| `Rating` → vis: [quant, ordinal] | Only 5 distinct values | Prefer ordinal | Small discrete set → ordinal ticks natural |
| `Rating` → vis: [quant, ordinal] | 100-point scale, continuous-looking | Prefer quantitative | Large range → continuous axis cleaner |
| `Country` → vis: nominal | 150+ countries | Consider top-N filtering or map instead of bar | Nominal with extreme cardinality → unreadable |
| `Year` → vis: [temporal, ordinal] | Only 3 values: 2022, 2023, 2024 | Prefer ordinal | Sparse temporal → ordinal ticks better |
| `Percentage` → domain: bounded [0,100] | Actual data range [45, 55] | Narrow domain, zoom in | Bounded but data clustered → auto-zoom |
| `GenericMeasure` → agg: heuristic | Field name contains "count" | measure-sum | Name-based heuristic refines generic role |

**Design decision: where does this happen?**

This data-dependent resolution happens at **two distinct stages**, not one:

1. **Context determination time** (`resolveFieldSemantics`): The builder can use data statistics (cardinality, min/max, distinct count) to **disambiguate** the intrinsic dimension values. For example, `Rating` has `visEncodings: ['quantitative', 'ordinal']` — the builder picks between them based on distinct-value count. This is a resolution of ambiguity already present in the type registry. The result is a concrete `FieldSemantics` with a single chosen encoding, a resolved domain, etc.

2. **Instantiation time** (spec generation for a specific chart): The instantiation phase may **override** the context's resolved values based on the specific chart type, channel assignment, and visual constraints. For example:
   - A `Coded` field with 30 values is resolved as `nominal` in the context. But when assigned to a color channel, the instantiator may decide to show only top-10 + "Other" to prevent legend clutter — this is a presentation decision, not a type-level one.
   - A `Month` field resolved as `ordinal` in the context may be re-encoded as `temporal` if placed on X in a line chart — this is a chart-type-driven override.
   - An ordinal field with high cardinality assigned to color may be treated as quantitative (continuous ramp) to reduce clutter — this is a channel-specific adaptation.

**The boundary:** Context determination resolves *what the field IS* (its preferred encoding, format, domain, etc.). Instantiation resolves *how to render it given the chart constraints*. The context should carry enough information (including data statistics like cardinality) for the instantiator to make informed overrides without re-querying the type registry.

```typescript
interface FieldSemantics {
    // ... resolved dimension values ...

    // Data statistics carried forward for instantiation-time decisions
    dataStats: {
        cardinality: number;        // distinct value count
        nullRate: number;           // fraction of nulls
        min?: number;               // for numeric fields
        max?: number;
        sortedDistinctValues?: string[];  // for ordinal/nominal (if small enough)
    };
}
```

This way, the instantiator can check `context.dataStats.cardinality` and decide to bin, filter, or re-encode — without the context itself making premature presentation decisions.

### 0.8 Cyclic domain types

A special class of types has **cyclic** (wrap-around) domains:

| Type | Cycle | Values | Visualization concern |
|---|---|---|---|
| Month | 12 | Jan–Dec or 1–12 | Axis shouldn't show "13"; color interpolation wraps |
| Day (weekday) | 7 | Mon–Sun | Same |
| Hour | 24 | 0–23 | Circular charts natural |
| Direction | 8/16+ | N, NE, E, ... | Polar/radar natural |
| Quarter | 4 | Q1–Q4 | Axis ordering |

Cyclic types need:
- Built-in canonical sort (not alphabetical)
- No extrapolation beyond the cycle
- Cyclic color palettes for color encoding
- Radar/polar chart recommendations

---

## §1 Motivation

### 1.1 Current state — Four-stage pipeline

The chart engine uses a four-stage compilation pipeline, analogous to
LLVM's frontend → IR → middle-end → backend architecture:

| Stage | Function | Input → Output | Concern |
|-------|----------|---------------|--------|
| **1. Field Semantics** | `resolveFieldSemantics()` | Annotation + data → `FieldSemantics` | What *is* this field? (data identity) |
| **2. Channel Semantics** | `resolveChannelSemantics()` | FieldSemantics + channel → `ChannelSemantics` | How should it render on this channel? |
| **3. Layout** | `computeLayout()` | ChannelSemantics + data → `LayoutResult` | How big? What gets filtered? |
| **4. Spec Generation** | `assembleVegaLite()` etc. | ChannelSemantics + template → backend spec | Backend-specific output |

**`ChannelSemantics`** is the IR — a flat, target-agnostic interface that
decouples all upstream semantics (Stages 1–2) from all downstream
rendering (Stages 3–4). Four backends (VL, ECharts, ChartJS, GoFish)
all read the same `ChannelSemantics` record without knowing each other exist.

**Stage boundaries:**
- Stage 2 does NOT know about template mark types — zero-baseline
  finalization requires mark knowledge and happens in Stage 4.
- `convertTemporalData()` runs once before Stage 2; the converted data
  is passed to Stage 2 for temporal format detection and then reused
  by Stages 3–4.
- `FieldSemantics` is internal to Stage 2 — it is never exposed downstream.

`ChannelSemantics` is a flat interface — no nested `FieldSemantics` reference:

| Decision | Source | Output |
|---|---|---|
| **From field semantics (data identity)** | | |
| Semantic annotation | `resolveFieldSemantics()` | `ChannelSemantics.semanticAnnotation` |
| Number format | `resolveFieldSemantics()` → `resolveFormat()` | `ChannelSemantics.format` |
| Tooltip format | `resolveFieldSemantics()` → `resolveFormat()` | `ChannelSemantics.tooltipFormat` |
| Aggregation default | `resolveFieldSemantics()` → `resolveAggregationDefault()` | `ChannelSemantics.aggregationDefault` |
| Scale type | `resolveFieldSemantics()` → `resolveScaleType()` | `ChannelSemantics.scaleType` |
| Domain constraint | `resolveFieldSemantics()` → `resolveDomainConstraint()` | `ChannelSemantics.domainConstraint` |
| Canonical order | `resolveFieldSemantics()` → `resolveCanonicalOrder()` | `FieldSemantics.canonicalOrder` (internal) |
| Cyclic ordering | `resolveFieldSemantics()` → `resolveCyclic()` | `ChannelSemantics.cyclic` |
| Sort direction | `resolveFieldSemantics()` → `resolveSortDirection()` | `ChannelSemantics.sortDirection` |
| Zero class | `resolveFieldSemantics()` → `resolveZeroClassFromAnnotation()` | `FieldSemantics.zeroClass` (internal) |
| Binning suggested | `resolveFieldSemantics()` → `resolveBinningSuggested()` | `ChannelSemantics.binningSuggested` |
| **Channel-specific (visualization)** | | |
| Encoding type (Q/O/N/T) | `resolveEncodingTypeDecision()` | `ChannelSemantics.type` |
| Zero-baseline | `computeZeroDecision()` (Stage 4) | `ChannelSemantics.zero` |
| Color scheme | `getRecommendedColorSchemeWithMidpoint()` | `ChannelSemantics.colorScheme` (color/group only) |
| Temporal format | `resolveTemporalFormat()` | `ChannelSemantics.temporalFormat` |
| Ordinal sort order | `inferOrdinalSortOrder()` | `ChannelSemantics.ordinalSortOrder` |
| Nice rounding | `resolveNice()` | `ChannelSemantics.nice` |
| Tick constraint | `resolveTickConstraint()` | `ChannelSemantics.tickConstraint` |
| Axis reversal | `resolveReversed()` | `ChannelSemantics.reversed` |
| Interpolation | `resolveInterpolation()` | `ChannelSemantics.interpolation` |
| Stackable | `resolveStackable()` | `ChannelSemantics.stackable` |

These decisions are effective but they represent only a fraction of the visualization properties that semantic types should influence. Many properties are either hardcoded, delegated to VL defaults, or handled ad-hoc in template instantiation.

### 1.2 Properties not currently driven by semantic type

| Category | Property | Example gap |
|---|---|---|
| **Formatting** | Axis tick format, tooltip format, legend label format | `Price` should show "$1,234", `Percentage` should show "45%" |
| **Scale behavior** | Scale type (linear/log/sqrt), domain clamping, nice rounding | `Percentage` domain should clamp to [0, 100]; `Revenue` spanning 3 orders of magnitude could use log |
| **Axis direction** | Reversed axis | `Rank` should have 1 at top (reversed Y axis) |
| **Tick strategy** | Tick count, tick interval constraints | `Year` must have integer ticks only (no 2018.5); `Rating` 1-5 → exactly 5 ticks |
| **Aggregation** | Default aggregate function | `Revenue` → `sum`; `Temperature` → `average`; `Count` → `sum` |
| **Mark behavior** | Line interpolation, binning suitability, stack compatibility | `Rank` → step interpolation; `Age` (continuous) → suggest binning; `Rate` → don't stack |
| **Display metadata** | Unit labels, axis title suffixes | `Temperature` → "°C" or "°F"; `Weight` → "kg" or "lbs" |

### 1.3 Goal

Introduce a **FieldSemantics** — a structured object that captures all visualization-relevant decisions for a field, derived from its semantic type plus data characteristics. These properties are **promoted** into a flat `ChannelSemantics` struct — the single public interface consumed by all downstream phases (VL assembler, ECharts assembler, recommendation engine, tooltip renderer). `FieldSemantics` itself is an internal type used only inside `resolveChannelSemantics()`.

### 1.4 Non-goals

- Changing Stage 3 (layout/stretch model) — it stays data-driven
- Building a full "smart defaults" system that replaces user configuration — the compilation context provides *defaults* that users and templates can override

> **Note:** While §0 proposes adding new semantic types (Profit, Sentiment, NPS, etc.), the core taxonomy structure and string-based representation remain the same. The new types extend the existing catalog, they don't restructure it.

---

## §2 Design Principles

1. **Semantic type is the source of truth.** The compilation context is a deterministic function of (semanticType, dataValues, channel, markType). No hidden state.

2. **Decisions are structured, not scattered.** Instead of N separate functions that each know about semantic types, one builder produces a typed context object. Downstream code reads fields, never re-inspects the semantic type.

3. **Per-field, then per-channel.** Some decisions are intrinsic to the field (format, aggregation default, scale type) regardless of which channel it's mapped to. Others are channel-dependent (zero-baseline, reversed axis). The context has both layers.

4. **Override-friendly.** Every decision has a default from the semantic type. Users, templates, or the AI agent can override any individual decision without replacing the whole context. Overrides are explicit and traceable.

5. **Backend-agnostic.** The compilation context describes abstract visualization intent (e.g., "format as currency with 0 decimals", "reverse the axis"). Backend-specific translation (VL `axis.format` vs. ECharts `axisLabel.formatter`) happens in Stage 4 (spec generation).

6. **Semantic type + optional metadata.** The semantic type string alone (e.g., `'Rating'`) is not always sufficient. Certain types carry additional properties (domain, unit) that are critical for correct visualization. This metadata is provided alongside the semantic type as a structured annotation.

---

## §3 Semantic Type Annotation: Enriched Input

### 3.1 The problem with bare semantic type strings

Today, the LLM annotates each field with a single semantic type string:

```json
{ "rating": { "type": "number", "semantic_type": "Rating" } }
```

But `Rating` alone is ambiguous:
- Is it 0–5? 1–5? 1–10? 0–100?
- Should we show exact tick marks [1, 2, 3, 4, 5] or let the renderer choose?
- Is 0 a valid value (meaningful zero) or is the scale 1-based (arbitrary zero)?

Similar ambiguity exists for other bounded/scaled types:

| Type | What's missing | Why it matters |
|---|---|---|
| **Rating** | Scale range (1–5, 1–10, 0–100) | Tick marks, domain constraint, zero decision |
| **Score** | Scale range (0–100, 0–10) | Same as Rating |
| **Percentage** | Representation (0–1 vs 0–100) | Format string: `.1%` vs `.1f` + "%" |
| **Temperature** | Unit (°C, °F, K) | Format suffix, diverging midpoint (0°C vs 32°F) |
| **Physical measures** (any) | Unit (kg, km, mph, etc.) | Format suffix |
| **Price/Revenue/Cost/Amount** | Currency (USD, EUR, GBP, JPY) | Format prefix ($, €, £, ¥) |
| **Duration** | Unit (seconds, minutes, hours, days) | Format strategy ("2h 30m" vs "150 min") |

Notice this is NOT needed for open-ended measures like `Quantity`, `Count`, `Revenue` (generic), `Rank`, or categorical types like `Country`, `Status`. Those types have no inherent scale or unit ambiguity.

### 3.2 SemanticAnnotation: the enriched input

We extend the annotation format to carry optional metadata alongside the semantic type:

```typescript
/**
 * Enriched semantic annotation for a single field.
 *
 * The LLM (or user) provides this when annotating a dataset.
 * Only `semanticType` is required — all other fields are optional
 * hints that improve compilation decisions.
 *
 * Compact form: When no metadata is needed, a bare string is equivalent
 * to `{ semanticType: "..."}`. The system accepts both:
 *   "Rating"                                        // bare string
 *   { semanticType: "Rating" }                      // object, no metadata
 *   { semanticType: "Rating", intrinsicDomain: [1, 5] }  // object with metadata
 */
interface SemanticAnnotation {
    /** The semantic type string (e.g., 'Rating', 'Temperature', 'Price') */
    semanticType: string;

    /**
     * The intrinsic domain (value range) of this field's scale.
     * Only for bounded/scaled types — NOT for open-ended measures.
     *
     * Examples:
     *   Rating 1–5:        [1, 5]
     *   Score 0–100:       [0, 100]
     *   Percentage 0–1:    [0, 1]
     *   Percentage 0–100:  [0, 100]
     *   Level 1–10:        [1, 10]
     *   Latitude:          [-90, 90]  (always fixed)
     *
     * NOT used for: Revenue (open-ended), Count (open-ended),
     * Quantity (open-ended), Temperature (unit determines meaning,
     * not a fixed domain).
     *
     * When provided, drives:
     *   - domainConstraint in FieldSemantics
     *   - tickConstraint.exactTicks (for small discrete scales)
     *   - zeroClass refinement (scale starting at 1 → arbitrary zero)
     *   - colorSchemeHint.divergingMidpoint (via intrinsicDomain midpoint)
     */
    intrinsicDomain?: [number, number];

    /**
     * The unit of measurement for this field.
     * Strictly optional — the system works correctly without it.
     *
     * When present, provides cosmetic improvements:
     *   - format.suffix (e.g., "°C", " kg")
     *   - format.prefix (e.g., "$" for USD, "€" for EUR)
     *   - tooltip display with unit label
     *   - diverging midpoint hint (0 for °C, 32 for °F)
     *
     * When absent, the system still determines encoding, aggregation,
     * domain, zero-baseline, and color scheme correctly from the
     * semantic type alone. The only loss is axis/tooltip formatting.
     *
     * IMPORTANT: Users often have mixed units within the same field
     * (e.g., distances in both km and miles, prices in mixed currencies).
     * When the LLM cannot determine a single consistent unit, it should
     * omit this field rather than guess. The compilation logic must
     * never assume unit is present.
     *
     * Examples (when unit IS consistent):
     *   Temperature: "°C", "°F", "K"
     *   Weight:      "kg", "lbs", "g", "oz"
     *   Distance:    "km", "mi", "m", "ft"
     *   Speed:       "km/h", "mph", "m/s"
     *   Duration:    "seconds", "minutes", "hours", "days"
     *   Price:       "USD", "EUR", "GBP", "JPY"
     */
    unit?: string;

    /**
     * Canonical sort order for ordinal/categorical fields.
     * The LLM provides this when values have a meaningful non-alphabetical
     * ordering that cannot be inferred from the semantic type alone.
     *
     * For well-known ordinals (Month, DayOfWeek, etc.), the system can
     * infer the order from the type. But for domain-specific ordinals
     * the LLM must provide it explicitly.
     *
     * Examples:
     *   Education level:  ["High School", "Bachelor's", "Master's", "PhD"]
     *   Severity:         ["Low", "Medium", "High", "Critical"]
     *   T-shirt size:     ["XS", "S", "M", "L", "XL", "XXL"]
     *   Satisfaction:     ["Very Unsatisfied", "Unsatisfied", "Neutral", "Satisfied", "Very Satisfied"]
     *
     * NOT needed for: Month (built-in), DayOfWeek (built-in), Year (numeric),
     * Country (no inherent order), PersonName (no inherent order).
     *
     * When provided, drives:
     *   - canonicalOrder in FieldSemantics
     *   - axis/legend ordering
     *   - ordinal scale domain
     */
    sortOrder?: string[];
}
```

### 3.3 Which types need metadata?

| Type | `intrinsicDomain` | `unit` | `sortOrder` | Why |
|---|---|---|---|---|
| **Rating** | **yes** — [1,5], [1,10], [0,100] | no | no | Scale determines ticks, domain, zero |
| **Score** | **yes** — [0,100], [0,10], [0,1000] | no | no | Same as Rating |
| **Percentage** | semi — inferred from data (0–1 vs 0–100) | no | no | Representation affects format |
| **Temperature** | no (open-ended) | optional — °C, °F, K | no | Suffix + diverging midpoint hint; omit if mixed |
| **Physical** (any) | no | optional — kg, km, mph, etc. | no | Suffix only; omit if mixed |
| **Duration** | no | optional — sec, min, hr, day | no | Display hint; omit if mixed |
| **Price** | no | optional — USD, EUR, GBP | no | Prefix ($, €, £); omit if mixed currencies |
| **Revenue** | no | optional — USD, EUR, GBP | no | Prefix; omit if mixed currencies |
| **Cost** | no | optional — USD, EUR, GBP | no | Prefix; omit if mixed currencies |
| **Amount** | no | optional — USD, EUR, GBP | no | Prefix; omit if mixed currencies |
| **Latitude** | fixed [-90, 90] | no | no | Always known; no annotation needed |
| **Longitude** | fixed [-180, 180] | no | no | Always known |
| Count, Quantity, Rank, ID, ... | no | no | no | No ambiguity |
| **Ordinal categoricals** (Severity, Size, Education) | no | no | **yes** — domain-specific order | LLM provides canonical ordering |
| Well-known ordinals (Month, DayOfWeek) | no | no | no (built-in) | System infers order; cyclic derived from type |
| Nominal categoricals (Country, Name, Status) | no | no | no | No inherent order |
| **Sentiment**, **Correlation**, **Profit** | no | no (or currency) | no | Diverging midpoint inferred from type (see §5.10) |
| **Domain-specific diverging** (pH, NPS, custom) | **yes** — e.g., [0, 14] for pH | no | no | Diverging midpoint derived from `intrinsicDomain` midpoint |

### 3.4 LLM prompt update

The annotation prompt changes minimally. The output schema becomes:

```json
{
    "fields": {
        "rating": { "type": "number", "semantic_type": "Rating", "intrinsic_domain": [1, 5] },
        "temperature": { "type": "number", "semantic_type": "Temperature", "unit": "°F" },
        "price": { "type": "number", "semantic_type": "Price", "unit": "USD" },
        "score": { "type": "number", "semantic_type": "Score", "intrinsic_domain": [0, 100] },
        "severity": { "type": "string", "semantic_type": "Coded", "sort_order": ["Low", "Medium", "High", "Critical"] },
        "sentiment": { "type": "number", "semantic_type": "Sentiment" },
        "ph_level": { "type": "number", "semantic_type": "Score", "intrinsic_domain": [0, 14] },
        "name": { "type": "string", "semantic_type": "PersonName" },
        "revenue": { "type": "number", "semantic_type": "Revenue" },
        "season": { "type": "string", "semantic_type": "Coded", "sort_order": ["Spring", "Summer", "Fall", "Winter"] }
    }
}
```

Guidelines added to the prompt:

```
- For Rating and Score: provide "intrinsic_domain" as [min, max] of the scale
  (e.g., [1, 5] for 5-star rating, [0, 100] for percentage score)
- For Temperature and other Physical measures: provide "unit"
  (e.g., "°C", "kg", "km", "mph", "seconds")
- For Price, Revenue, Cost, Amount: provide "unit" with currency code
  (e.g., "USD", "EUR", "GBP", "JPY")
- For ordinal categorical fields with a meaningful non-alphabetical order:
  provide "sort_order" as an array from lowest to highest
  (e.g., ["Low", "Medium", "High"] for severity,
   ["XS", "S", "M", "L", "XL"] for clothing size)
- For well-known ordinals (Month, DayOfWeek): sort_order is NOT needed
  (the system knows built-in orderings)
- Cyclic detection (Month, DayOfWeek, Quarter, Hour, Direction, seasons)
  is handled automatically by the system — no annotation needed
- For all other types: no additional metadata needed
```

### 3.5 Types with multiple intrinsic data representations

Some semantic types can appear in fundamentally **different numeric encodings** in the raw data. This is NOT unit ambiguity (kg vs lbs, °C vs °F) — unit differences are already handled by the optional `unit` field (§3.2). Representation ambiguity is about the **same concept encoded at different scales or data types**, which affects format strings, domain bounds, and tick generation.

| Type | Representation A | Representation B | Other representations | How the builder detects |
|---|---|---|---|---|
| **Percentage / Rate** | Fractional: 0.48 (0–1 range) | Whole-number: 48 (0–100 range) | Per-mille: 480 (0–1000) | `max(data) ≤ 1.0` → fractional; `max(data) ≤ 100` → whole; or `intrinsicDomain` annotation |
| **Timestamp** | Unix seconds: 1705312200 | Unix milliseconds: 1705312200000 | ISO string: "2024-01-15T14:30:00" | Magnitude: >1e12 → ms; >1e9 → s; string → parse |
| **Month** | Numeric: 1–12 | Abbreviated string: "Jan"–"Dec" | Full name: "January"–"December" | Data type (number vs string); string pattern matching |
| **Day** | Numeric: 0–6 or 1–7 | Abbreviated: "Mon"–"Sun" | Full: "Monday"–"Sunday"; day-of-month: 1–31 | Data type + value range + string pattern |
| **Year** | Number: 2024 | String: "2024" | Two-digit: 24 | Data type; value range (0–99 → two-digit ambiguity) |
| **Boolean** | Boolean: true/false | Numeric: 0/1 | String: "Yes"/"No", "Y"/"N", "True"/"False" | Data type + distinct values |
| **Coordinates** | Decimal degrees: 47.6062 | DMS string: "47°36'22\"N" | [lat, lon] tuple | Data type: number vs string pattern |

**Why this matters — concrete example (Percentage):**

| Concern | Fractional (0–1) | Whole-number (0–100) |
|---|---|---|
| Format pattern | `.1%` (d3 auto-multiplies ×100) | `.0f` + suffix `%` |
| Domain constraint | `[0, 1]` | `[0, 100]` |
| Tick values | 0, 0.25, 0.5, 0.75, 1.0 | 0, 25, 50, 75, 100 |
| Tooltip | "48.3%" | "48%" |

Getting the representation wrong means the axis shows `4800%` instead of `48%`, or domain clips to `[0, 1]` when data is 0–100.

**Why this matters — concrete example (Timestamp):**

| Concern | Unix seconds | Unix milliseconds |
|---|---|---|
| Conversion | `new Date(v * 1000)` | `new Date(v)` |
| Misdetection effect | Dates in 1970 (ms interpreted as s) or year 55970 (s interpreted as ms) | Same |

**Design decision:** The builder resolves representation at context-determination time using a priority chain:

1. **Explicit annotation** — `domain: [0, 1]` disambiguates percentage; `unit: "milliseconds"` disambiguates timestamp
2. **Data inspection** — value range, magnitude, data type, distinct values, string patterns
3. **Conservative default** — when ambiguous, pick the most common representation

The resolved representation is baked into the `FieldSemantics` (format, domain, ticks). Downstream consumers never need to reason about which representation was in the data.

### 3.6 Backward compatibility

Bare string annotations continue to work:

```typescript
// Normalize: accept both string and object forms
function normalizeAnnotation(
    input: string | SemanticAnnotation
): SemanticAnnotation {
    if (typeof input === 'string') {
        return { semanticType: input };
    }
    return input;
}
```

The `semantic_types` map in `ChartAssemblyInput` changes type:

```typescript
// Before:
semantic_types?: Record<string, string>;

// After (with backward compat):
semantic_types?: Record<string, string | SemanticAnnotation>;
```

### 3.6 How annotation metadata flows into FieldSemantics

The `resolveFieldSemantics` function accepts the full annotation:

```
resolveFieldSemantics(annotation: SemanticAnnotation, fieldName, values)
    │
    ├── annotation.intrinsicDomain provided?
    │     → domainConstraint = mergeIntrinsicWithData(intrinsicDomain, values, soft)
    │       (effective domain = union of intrinsic bounds and actual data range)
    │     → tickConstraint.exactTicks (if intrinsic range is small, e.g., [1,5] → [1,2,3,4,5])
    │     → zeroClass: intrinsicDomain[0] > 0 → 'arbitrary' (1-based scale)
    │     → binningSuggested: false (bounded discrete scale)
    │     → colorSchemeHint.divergingMidpoint: (intrinsicDomain[0] + intrinsicDomain[1]) / 2
    │
    ├── annotation.unit provided?
    │     → format.suffix or format.prefix (unit → display mapping)
    │     → tooltipFormat.suffix (more verbose: "°F" instead of "°")
    │     → diverging midpoint hint (°C → 0, °F → 32)
    │
    ├── annotation.sortOrder provided?
    │     → canonicalOrder = sortOrder
    │     → defaultVisType = 'ordinal' (not 'nominal')
    │
    └── none provided?
          → fall back to type-only + data-driven inference
          → diverging midpoint inferred by resolveDivergingInfo() (see §5.10)
```

---

## §4 FieldSemantics: The Core Structure

### 4.1 Type definition

```typescript
/**
 * Complete field semantics for a single data field.
 *
 * Computed once per field during Stage 1 (field semantic resolution).
 * Read-only downstream — backends translate this to their native format.
 *
 * These are FIELD-INTRINSIC properties — they depend on the semantic type,
 * annotation metadata, and data values, NOT on which channel the field is
 * mapped to. Channel-specific decisions (color scheme, axis reversal,
 * interpolation, tick strategy, nice rounding, stacking, zero-baseline)
 * are resolved separately in Stage 2 (resolveChannelSemantics) and live
 * on ChannelSemantics.
 */
interface FieldSemantics {
    // --- Identity ---
    /** The semantic annotation (normalized from string or object input).
     *  Contains the semantic type string plus optional metadata
     *  (intrinsicDomain, unit, sortOrder).
     */
    semanticAnnotation: SemanticAnnotation;

    // --- Encoding ---
    /** Preferred encoding type, disambiguated from registry using data */
    defaultVisType: 'quantitative' | 'ordinal' | 'nominal' | 'temporal';

    // --- Formatting ---
    /**
     * Primary number format spec.
     * Non-empty only when the semantic type adds value over VL's native
     * formatting: currency prefix ($), unit suffix (kg), signed prefix (+/-),
     * percentage (%), abbreviation (1.2M).
     * For generic decimals (formatClass 'decimal'), format is empty {}
     * because VL's native formatting adapts precision better.
     */
    format: FormatSpec;

    /**
     * Tooltip format — typically with explicit precision for pop-ups
     * even when the axis format is left to VL defaults.
     */
    tooltipFormat?: FormatSpec;

    // --- Aggregation ---
    /**
     * Default aggregate function — intrinsic to the field (additive vs intensive).
     * 'sum' for additive measures (Revenue, Count), 'average' for intensive
     * measures (Temperature, Rating). undefined for non-aggregable fields.
     */
    aggregationDefault?: 'sum' | 'average';

    // --- Scale ---
    /**
     * Zero-baseline classification (meaningful / arbitrary / contextual).
     * NOT a boolean decision — that requires channel + mark type knowledge
     * and is finalized as ChannelSemantics.zero in Stage 4.
     */
    zeroClass: ZeroClass | 'unknown';

    /**
     * Recommended scale type based on data distribution.
     * Only set for specific semantic types (e.g., Population → 'log' when
     * data spans ≥ 4 orders of magnitude).
     */
    scaleType?: 'linear' | 'log' | 'sqrt' | 'symlog';

    // --- Domain ---
    /**
     * Intrinsic domain bounds (from annotation, type-intrinsic, or data-inferred).
     * E.g., Rating [1, 5], Latitude [-90, 90], Percentage [0, 100].
     */
    domainConstraint?: DomainConstraint;

    // --- Ordering ---
    /**
     * Canonical ordinal sort order (months, days, seasons, etc.).
     * Resolved from annotation.sortOrder or well-known type sequences.
     */
    canonicalOrder?: string[];

    /** Whether the canonical order is cyclic (wraps around) */
    cyclic: boolean;

    /** Default sort direction ('descending' for Rank, 'ascending' for rest) */
    sortDirection: 'ascending' | 'descending';

    // --- Histogram ---
    /** Whether this field's data distribution benefits from binning */
    binningSuggested: boolean;
}
```

**What is NOT on FieldSemantics (and why):**

These properties are resolved at the channel level in `resolveChannelSemantics()`
because they depend on which channel the field is mapped to, or need
channel-level context:

| Property | Why channel-level | Resolved by |
|---|---|---|
| `nice` | Depends on whether `domainConstraint` exists (field-level) but also whether the domain is bounded or fixed — resolved together with domain | `resolveNice()` |
| `tickConstraint` | Depends on type + annotation domain; resolved alongside channel | `resolveTickConstraint()` |
| `reversed` | Only meaningful on positional axes (x/y) | `resolveReversed()` |
| `interpolation` | Only meaningful for line/area marks | `resolveInterpolation()` |
| `stackable` | Only meaningful for positional channels with compatible marks | `resolveStackable()` |
| `colorScheme` | Only meaningful on color/group channel; needs VL type + data | `getRecommendedColorSchemeWithMidpoint()` |
| `zero` | Requires mark type (bar → include zero); finalized in Stage 4 | `computeZeroDecision()` |
| `temporalFormat` | Needs converted temporal data for format detection | `resolveTemporalFormat()` |
| `ordinalSortOrder` | Uses `inferOrdinalSortOrder()` with field values, respects user sort overrides | `inferOrdinalSortOrder()` |

### 4.2 Supporting types

```typescript
/**
 * T0 Family — coarsest tier (§0.2).
 * Used internally by the builder to resolve compilation context.
 * NOT exposed on FieldSemantics — consumers use the
 * materialized properties instead.
 */
type T0Family =
    | 'Temporal'         // DateTime, Year, Month, Duration, etc.
    | 'Measure'          // Quantity, Price, Revenue, Temperature, etc.
    | 'Discrete'         // Rank, Score, Rating, Index, etc.
    | 'Categorical'      // Name, Status, Category, etc.
    | 'Ordinal'          // Domain-specific ordered categories
    | 'Geographic'       // Latitude, Country, etc.
    | 'Identifier';      // ID, SKU — never encode

/**
 * T1 Category — mid-level tier (§0.3).
 * Used internally by the builder. NOT exposed on FieldSemantics.
 */
type T1Category =
    | 'DateTime' | 'DateGranule' | 'Duration'               // Temporal
    | 'Amount' | 'Physical' | 'Proportion'                   // Measure
    | 'SignedMeasure' | 'GenericMeasure'                      // Measure
    | 'Rank' | 'Score' | 'Index'                              // Discrete
    | 'GeoCoordinate' | 'GeoPlace'                            // Geographic
    | 'Entity' | 'Coded' | 'Binned'                           // Categorical
    | 'ID';                                                    // Identifier

/**
 * Format specification — backend-agnostic.
 *
 * Provides the numeric format pattern, optional prefix/suffix, and unit.
 * How these are rendered (tick labels, axis title, tooltip) is the
 * renderer's decision — the context just carries the information.
 */
interface FormatSpec {
    /**
     * d3-format pattern (used by VL natively; ECharts translates).
     * Examples: "$,.0f", ".1%", ".2f", ",d"
     */
    pattern?: string;

    /** Prefix for formatted value. E.g., "$", "€", "£", "¥" */
    prefix?: string;

    /** Suffix for formatted value. E.g., "%", "°C", " kg" */
    suffix?: string;

    /** Number of decimal places (overrides pattern precision) */
    decimals?: number;

    /**
     * Whether to abbreviate large/small numbers.
     * true → 1234567 → "1.2M", 0.00123 → "1.2m"
     */
    abbreviate?: boolean;

    /**
     * Temporal format string (strftime-style).
     * Used when the field is temporal. E.g., "%Y", "%b %d", "%H:%M"
     */
    temporalPattern?: string;
}

/** Aggregate operations */
type AggregateOp = 'sum' | 'average' | 'median' | 'min' | 'max' | 'count';

/** Scale types for quantitative axes */
type ScaleType = 'linear' | 'log' | 'sqrt' | 'symlog';

/** Hard domain constraints */
interface DomainConstraint {
    min?: number;
    max?: number;
    /**
     * Whether to hard-clamp values outside the constraint.
     * true: values outside [min, max] are clipped to the boundary.
     * false: constraint is a suggestion — renderer may extend if data exceeds.
     */
    clamp?: boolean;
}

/** Tick generation constraints */
interface TickConstraint {
    /** Force ticks to be integers only (e.g., Year, Count, Rating) */
    integersOnly?: boolean;

    /** 
     * Exact set of tick values (e.g., Rating 1-5 → [1, 2, 3, 4, 5]).
     * When specified, overrides automatic tick calculation.
     */
    exactTicks?: number[];

    /**
     * Suggested tick count. Renderer may adjust based on available space.
     */
    suggestedCount?: number;

    /**
     * Minimum step between ticks (e.g., 1 for integer types).
     */
    minStep?: number;
}

/** Color scheme hint (drives getRecommendedColorScheme) */
interface ColorSchemeHint {
    /** Primary scheme type */
    type: 'categorical' | 'sequential' | 'diverging';

    /**
     * Whether to reverse the color scale direction.
     * true for Rank (1 = best = darkest/most saturated).
     */
    reversed?: boolean;

    /**
     * Natural midpoint for diverging schemes.
     * This is the semantic center of the data — the value that should
     * map to the neutral color in diverging palettes.
     *
     * Sources (in priority order):
     *   1. annotation.unit → type lookup (°C → 0, °F → 32)
     *   2. Type-intrinsic (Profit → 0, Correlation → 0)
     *   3. Domain midpoint (Rating [1,5] → 3)
     *   4. Data-driven: spansBothSides(0) → 0, else data midpoint
     *
     * Only meaningful when type = 'diverging'.
     */
    divergingMidpoint?: number;

    /**
     * Whether the diverging nature is inherent to the type (true)
     * or conditional on the data spanning both sides (false).
     *
     * Inherent: Sentiment (always has pos/neg meaning),
     *           Correlation (always -1 to 1)
     * Conditional: Temperature (diverging only if data crosses 0°C),
     *              Revenue (diverging only if data has losses),
     *              Percentage (diverging only if data has negatives)
     *
     * When inherentlyDiverging = true:
     *   - Always use diverging scheme, even if all data is on one side
     *   - The midpoint carries semantic meaning regardless
     *
     * When inherentlyDiverging = false (default):
     *   - Only use diverging scheme if data actually spans both sides
     *     of the midpoint
     *   - Fall back to sequential if all values are on one side
     */
    inherentlyDiverging?: boolean;
}

/** Line interpolation methods */
type Interpolation = 'linear' | 'monotone' | 'step' | 'step-after' | 'step-before';
```

---

## §5 Semantic Type → Context Mapping

### 5.1 Format rules

The format is the most impactful new capability. The context provides format information (pattern, prefix, suffix); the **renderer** decides how to use them — whether to put the unit on tick labels, in the axis title, or only in tooltips is a rendering concern, not a compilation concern.

**Design principle — only override VL's native formatting when semantic context adds value.**

VL's default axis formatting is excellent — it adapts precision, uses ~s notation for large values, and produces clean integer labels for integer data. We only provide an explicit format when:
- There's a **prefix** ($, €, +) or **suffix** (%, °C, kg) that VL can't know about
- There's an **abbreviation** need (1.2M instead of 1200000)
- There's a **sign** requirement (+12% / -5%) that VL won't add by default
- There's a **no-comma** override (Year: 2024 not 2,024)

For generic decimal types (Number, Score, Rating, Ratio, Latitude, Longitude), the format is **empty** — VL handles axis formatting natively and does it better than any hardcoded precision.

**Data-driven precision:** When format IS provided (currency, percent, unit-suffix, etc.), the precision is **data-driven** rather than hardcoded. The `detectPrecision()` helper examines actual data values and returns the maximum meaningful decimal places (0–4, capped to avoid floating-point noise). This means:
- Revenue data `[120000, 230000]` → `$120K, $230K` (0 decimals)
- Price data `[12.50, 8.99]` → `$12.50, $8.99` (2 decimals, always for Price)
- Temperature data `[23.5, 18.2]` → `23.5°C, 18.2°C` (1 decimal)

| Semantic Type | `pattern` | `prefix` | `suffix` | `abbreviate` | Tooltip override | Notes |
|---|---|---|---|---|---|---|
| **Count** | `,d` | — | — | — | — | Integer with thousands sep |
| **Amount** | data-driven precision | `$` | — | yes | `,.2f` + prefix `$` | |
| **Price** | `,.2f` | `$` | — | yes | — | Always shows cents |
| **Revenue** | data-driven precision | `$` | — | yes | `,.2f` + prefix `$` | |
| **Cost** | data-driven precision | `$` | — | yes | `,.2f` + prefix `$` | |
| **Percentage** (0–1) | `.Xp%` | — | — | — | `.X+1p%` | Auto-detects 0–1 vs 0–100 |
| **Percentage** (0–100) | data-driven + `d`/`.Xf` | — | `%` | — | same | Suffix, no ×100 |
| **PercentageChange** | `+.X%` or `+.Xf` | — | `%` (if 0–100) | — | higher-precision | Always-show sign |
| **Temperature** | data-driven precision | — | from unit (`°C`) | — | higher-precision | Unit from annotation |
| **Score** | — (empty) | — | — | — | data-driven precision | VL handles axis natively |
| **Rating** | — (empty) | — | — | — | data-driven precision | VL handles axis natively |
| **Rank** | `,d` | — | — | — | — | Integer |
| **Year** | `d` | — | — | — | — | No comma (2024 not 2,024) |
| **Number** | — (empty) | — | — | — | data-driven precision | VL handles axis natively |
| **Quantity** | data-driven precision | — | from unit | yes | — | Unit from annotation |
| **Profit** | `+` + data-driven | `$` | — | yes | `+,.2f` + prefix `$` | Signed currency |
| **Sentiment** | `+` + data-driven | — | — | — | higher-precision | Signed decimal |
| **Correlation** | `+` + data-driven | — | — | — | higher-precision | Signed decimal |
| **Latitude, Longitude** | — (empty) | — | — | — | data-driven precision | VL handles axis natively |
| **Ratio** | — (empty) | — | — | — | data-driven precision | VL handles axis natively |

**Unit and currency from annotation metadata:** When the LLM provides `unit` in the annotation (e.g., `"unit": "EUR"` for Price, `"unit": "kg"` for Weight), the format spec uses that directly. See §3 for the full annotation schema.

**Fallback priority for units:** annotation.unit > column-name heuristics ("Weight (kg)") > data-value scanning ("$1,234") > type-specific defaults ("$" for Price).

### 5.1.1 Parsing

Parsing is the **compiler's responsibility**, not part of the compilation context. The semantic type already tells the compiler what the data represents — the compiler decides how to clean it.

For example, knowing a field is `Amount` tells the compiler to strip `$` and `,` from `"$1,234.56"`. Knowing it's `Percentage` with string representation tells it to strip `%`. The semantic type + data representation (§3.5) provide all the information needed; no separate parse hint interface is required.

**Semantic type as parsing guide:**

| Semantic Type | Raw data examples | Compiler knows to... |
|---|---|---|
| Amount, Price, Revenue, Cost | `"$1,234.56"`, `"€1.234,56"` | Strip currency symbol + separators → number |
| Percentage, PercentageChange | `"45.2%"`, `"+12.3%"` | Strip `%` and sign → number |
| Temperature, Quantity (with unit) | `"23.5°C"`, `"75 kg"` | Strip unit suffix → number |
| Duration | `"2h 30m"`, `"02:30:00"` | Parse compound time → seconds |
| Timestamp | `1705312200`, `"2024-01-15"` | Detect epoch vs string → Date |
| Boolean | `"Yes"`, `"No"`, `1`, `0` | Normalize → boolean |
| Month | `"January"`, `1` | Normalize → canonical form |
| Coordinates | `"47°36'22"N"` | DMS → decimal degrees |

The compiler may provide built-in parsing utilities internally, but that's an implementation detail — not something the compilation context needs to describe.

### 5.2 Aggregation defaults

| Semantic Family | Semantic Types | Default Aggregate | Rationale |
|---|---|---|---|
| **Additive measures** | Count, Amount, Revenue, Cost, Quantity, Duration | `sum` | These represent totals — summing is natural |
| **Intensive measures** | Percentage, PercentageChange, Temperature, Score, Rating, Price, Correlation, Sentiment | `average` | These represent rates/conditions — averaging is natural |
| **Signed additive** | Profit | `sum` | Additive but can be negative; summing preserves sign semantics |
| **Discrete numeric** | Rank, Index, ID | — (none) | Aggregation is meaningless |
| **Temporal** | DateTime, Date, Year, etc. | — (none) | Not aggregable |
| **Categorical** | Name, Status, Category, etc. | — (none) | Not aggregable |

**When this helps:** When a bar chart is created with Revenue on Y, the system auto-applies `aggregate: 'sum'` (total revenue per category). For Temperature on Y, it auto-applies `aggregate: 'average'` (mean temperature per category). Currently, the AI agent or the user must specify this.

### 5.3 Scale type recommendations

| Condition | Recommended Scale | Example |
|---|---|---|
| Measure type + data spans >2 orders of magnitude | `log` | Revenue: $1K to $1B |
| Measure type + data has long tail (skew > 2) | `sqrt` | Population: most cities small, few very large |
| Measure type + data spans both positive and negative + wide range | `symlog` | Profit/Loss: -$10M to +$500M |
| Percentage (0-100) | `linear` (always) | Completion rate |
| All other quantitative | `linear` | Default |

**Implementation note:** Scale type recommendation requires inspecting data distribution (min, max, skewness). This makes it a **data-dependent** decision that belongs in the compilation context builder, not in a static mapping.

### 5.4 Domain constraints

Domain constraints come from two sources: **annotation metadata** (explicit `intrinsicDomain` from the LLM) and **type-intrinsic knowledge** (geographic bounds, etc.).

The effective domain stored in `FieldSemantics.domainConstraint` is always the **union** of the intrinsic domain and the actual data range. This ensures data points that exceed the type's natural bounds (e.g., 155% growth for a Percentage type) are never clipped.

Two categories:

- **Hard domains** (`clamp: true`): physically impossible to exceed — Latitude [-90, 90], Longitude [-180, 180], Correlation [-1, 1]. The intrinsic bounds _are_ the final bounds.
- **Soft domains** (`clamp: false`): intrinsic bounds describe the _typical_ range, but data can legitimately exceed them. Effective domain = `[min(intrinsic[0], dataMin), max(intrinsic[1], dataMax)]`.

| Source | Semantic Type | Intrinsic Domain | Data Range | Effective Domain | Clamp? |
|---|---|---|---|---|---|
| **Annotation** | Rating (domain: [1, 5]) | [1, 5] | [1, 4] | `{ min: 1, max: 5 }` | soft |
| **Annotation** | Score (domain: [0, 100]) | [0, 100] | [0, 120] | `{ min: 0, max: 120 }` | soft |
| **Data-inferred** | Percentage (0–100 data) | [0, 100] | [0, 80] | `{ min: 0, max: 100 }` | soft |
| **Data-inferred** | Percentage (> 100 data) | [0, 100] | [0, 155] | `{ min: 0, max: 155 }` | soft |
| **Data-inferred** | Percentage (0–1 data) | [0, 1] | [0, 0.8] | `{ min: 0, max: 1 }` | soft |
| **Type-intrinsic** | Latitude | [-90, 90] | any | `{ min: -90, max: 90 }` | hard |
| **Type-intrinsic** | Longitude | [-180, 180] | any | `{ min: -180, max: 180 }` | hard |
| **Type-intrinsic** | Correlation | [-1, 1] | any | `{ min: -1, max: 1 }` | hard |

**Priority:** annotation.intrinsicDomain > type-intrinsic > data-inferred.

**Percentage scale detection:** The representation (0–1 fractional vs 0–100 whole-number) is detected from data: if ≥ 80% of absolute values are ≤ 1, treat as fractional; otherwise whole-number. This works even when values exceed the intrinsic range (e.g., [10, 20, 155] → whole-number → intrinsic [0, 100] → effective [0, 155]).

When `annotation.intrinsicDomain` is provided, the builder also derives:
- **zeroClass:** If `intrinsicDomain[0] > 0` (e.g., Rating [1, 5]), zero is arbitrary. If `intrinsicDomain[0] === 0` (e.g., Score [0, 100]), zero is contextual.
- **tickConstraint:** If the intrinsic domain span is small (≤ 20), generate `exactTicks` for every integer. E.g., Rating [1, 5] → `exactTicks: [1, 2, 3, 4, 5]`.
- **binningSuggested:** If intrinsic domain span ≤ 20, binning is not useful → `false`.
- **colorSchemeHint.divergingMidpoint:** `(intrinsicDomain[0] + intrinsicDomain[1]) / 2`. E.g., Score [0, 100] → midpoint 50.

### 5.5 Tick constraints

Tick constraints combine type-intrinsic rules with annotation-provided domain:

| Semantic Type | `integersOnly` | `exactTicks` | `minStep` | Source |
|---|---|---|---|---|
| Count | true | — | 1 | Type-intrinsic |
| Year | true | — | 1 | Type-intrinsic |
| Rank | true | — | 1 | Type-intrinsic |
| Rating (domain: [1, 5]) | true | [1, 2, 3, 4, 5] | 1 | Annotation domain |
| Rating (domain: [1, 10]) | true | [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] | 1 | Annotation domain |
| Score (domain: [0, 100]) | true | — (too many) | 1 | Annotation domain (span > 20 → no exactTicks) |
| Month (1-12) | true | [1..12] | 1 | Type-intrinsic |
| Index | true | — | 1 | Type-intrinsic |

**Rule for exactTicks from annotation domain:** When `domain` is provided and `domain[1] - domain[0] ≤ 20`, generate integer ticks from `domain[0]` to `domain[1]`. When span > 20, use `integersOnly: true` with `minStep: 1` and let the renderer choose tick count.

### 5.6 Reversed axis

| Semantic Type | Reversed? | Rationale |
|---|---|---|
| Rank | `true` | 1st place should be at the top (Y axis) or leftmost (X axis) |
| All others | `false` | Standard direction |

**Note:** Reversed axis is a *default suggestion*. A bump chart template may already handle rank reversal internally (via `scale.reverse`). The compilation context provides the intent; the template decides whether to apply it.

### 5.7 Stack compatibility

| Semantic Type | Stackable | Mode | Rationale |
|---|---|---|---|
| Count, Amount, Revenue, Cost, Quantity | `'sum'` | Additive | Parts sum to whole |
| Percentage | `'normalize'` | Normalize | Show proportion breakdown |
| Temperature, Score, Rating, PercentageChange, Correlation, Sentiment | `false` | — | Stacking rates/conditions is meaningless |
| Rank, Index | `false` | — | Not aggregable |
| Duration, Profit | `'sum'` | Additive | Duration is additive; Profit sums to net |

### 5.8 Interpolation hints

| Semantic Type | Interpolation | Rationale |
|---|---|---|
| Rank, Index | `'step'` | Value stays constant until next transition |
| Rating, Score | `'step'` or `'linear'` | Quasi-continuous; context-dependent |
| Temperature, Quantity | `'monotone'` | Smooth physical process |
| Count | `'step-after'` or `'linear'` | Discrete events; depends on context |
| Revenue, Price, Amount, Profit | `'monotone'` | Smooth trend |
| Percentage, PercentageChange, Correlation | `'monotone'` | Smooth trend |
| All others / unknown | `'linear'` | Default |

### 5.9 Binning suitability

| Semantic Type | Suggest Binning? | Rationale |
|---|---|---|
| Quantity, Amount, Price, Revenue, Cost | `true` | Continuous, benefits from distribution view |
| Temperature | `true` | Continuous measure |
| Percentage, PercentageChange | `true` | Continuous, though bounded |
| Duration | `true` | Continuous time span |
| Count | `true` (if high-card) | Many distinct values → bin |
| Score (continuous range) | `true` | e.g., 0-100 scores |
| Rating (1-5, 1-10) | `false` | Too few values to bin |
| Rank | `false` | Ordinal; binning loses identity |
| Year | `false` | Should use temporal axis, not bins |
| All categorical | `false` | Not numeric |

### 5.10 Diverging point inference

Diverging treatment (color scheme + axis centering) requires knowing a **midpoint** — the value that separates two opposing meanings. This midpoint can come from multiple sources, resolved in priority order:

**Priority chain for diverging midpoint:**

```
1. annotation.unit → type lookup        (°C → 0, °F → 32, K → 273.15)
2. type-intrinsic midpoint              (see table below)
3. annotation.intrinsicDomain midpoint  (Rating [1,5] → 3)
4. data-driven: spansBothSides(0)       (data has both neg + pos → midpoint 0)
5. data-driven: midpoint of data range  (fallback)
```

**Type-intrinsic midpoints (no annotation needed):**

| Semantic Type | Midpoint | Inherently diverging? | Rationale |
|---|---|---|---|
| Temperature | 0 (°C) / 32 (°F) / 273.15 (K) | **conditional** — only when data spans both sides | freezing/thawing boundary; but all-positive temp data is fine as sequential |
| Profit | 0 | **conditional** | gain vs loss; but all-profitable data doesn't need diverging |
| Sentiment | 0 | **inherent** — always meaningful | positive vs negative sentiment, even if all values happen to be positive |
| Correlation | 0 | **inherent** | positive vs negative correlation |
| PercentageChange | 0 | **conditional** | growth vs decline; but all-growth data is fine as sequential |
| Score (0–100 scale) | 50 | **conditional** | above/below average; only when data spans both sides |
| Rating (1–5 scale) | 3 | **conditional** | derived from domain midpoint; rarely used as diverging |

**Key distinction — inherent vs. conditional:**

- **Inherently diverging** types always benefit from a diverging palette because the two sides carry distinct semantic meanings (e.g., positive vs negative sentiment). Even if all data points are positive, the color encodes "how positive" vs "how negative" relative to the center.

- **Conditionally diverging** types only use a diverging palette when the data actually spans both sides of the midpoint. If Revenue is all positive, a sequential palette (darker = more revenue) is more informative than a diverging palette with an unused half.

**`resolveDivergingInfo()` utility:**

```typescript
interface DivergingInfo {
    /** The midpoint value where the diverging center sits */
    midpoint: number;
    /** Whether this type is always diverging or only when data spans both sides */
    inherent: boolean;
    /** Source of the midpoint determination */
    source: 'unit' | 'type-intrinsic' | 'domain' | 'data';
}

/**
 * Resolve the diverging midpoint and whether the type is inherently diverging.
 *
 * Called by resolveColorSchemeHint() to populate ColorSchemeHint.
 *
 * @param semanticType  - The semantic type string
 * @param annotation    - Full annotation (may have intrinsicDomain, unit)
 * @param values        - Data values for data-driven fallback
 * @returns DivergingInfo or undefined if no diverging treatment applies
 */
function resolveDivergingInfo(
    semanticType: string,
    annotation: SemanticAnnotation,
    values: number[]
): DivergingInfo | undefined {
    // 1. Unit-derived (Temperature)
    if (semanticType === 'Temperature' && annotation.unit) {
        const unitMidpoints: Record<string, number> = {
            '°C': 0, '°F': 32, 'K': 273.15, 'C': 0, 'F': 32
        };
        if (annotation.unit in unitMidpoints) {
            return {
                midpoint: unitMidpoints[annotation.unit],
                inherent: false,  // only show diverging if data crosses it
                source: 'unit'
            };
        }
    }

    // 2. Type-intrinsic
    const intrinsicMap: Record<string, { midpoint: number; inherent: boolean }> = {
        'Sentiment':        { midpoint: 0, inherent: true },
        'Correlation':      { midpoint: 0, inherent: true },
        'Profit':           { midpoint: 0, inherent: false },
        'PercentageChange': { midpoint: 0, inherent: false },
    };
    if (semanticType in intrinsicMap) {
        return { ...intrinsicMap[semanticType], source: 'type-intrinsic' };
    }

    // 3. Domain-derived (e.g., Rating [1,5] → midpoint 3)
    if (annotation.intrinsicDomain) {
        return {
            midpoint: (annotation.intrinsicDomain[0] + annotation.intrinsicDomain[1]) / 2,
            inherent: false,
            source: 'domain'
        };
    }

    // 4. Data-driven: if data spans 0, use 0
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min < 0 && max > 0) {
        return { midpoint: 0, inherent: false, source: 'data' };
    }

    return undefined;  // no diverging treatment
}
```

**How it feeds into `resolveColorSchemeHint()`:**

```typescript
function resolveColorSchemeHint(semanticType, annotation, values): ColorSchemeHint {
    const divInfo = resolveDivergingInfo(semanticType, annotation, values);

    if (divInfo) {
        const min = Math.min(...values);
        const max = Math.max(...values);
        const spansBothSides = min < divInfo.midpoint && max > divInfo.midpoint;

        if (divInfo.inherent || spansBothSides) {
            return {
                type: 'diverging',
                divergingMidpoint: divInfo.midpoint,
                inherentlyDiverging: divInfo.inherent,
            };
        }
        // Data doesn't span both sides → sequential, but remember the midpoint
        // in case user explicitly requests diverging later
    }

    // Default: sequential for measures, categorical for nominals
    return { type: isQuantitative ? 'sequential' : 'categorical' };
}
```

---

## §6 Builder Function

### 6.1 Signature

```typescript
/**
 * Build the field semantics for a single field.
 *
 * This is the sole entry point for semantic-type-driven decisions.
 * All downstream code reads from the returned context.
 *
 * @param annotation  The semantic type annotation (string or enriched object)
 * @param fieldName   Column name (used for unit detection heuristics)
 * @param values      Sampled data values from this field
 * @returns           Complete field semantics with all defaults resolved
 */
function resolveFieldSemantics(
    annotation: string | SemanticAnnotation,
    fieldName: string,
    values: any[],
): FieldSemantics;
```

### 6.2 Internal structure

`resolveFieldSemantics` computes only **field-intrinsic** properties — things
determined by the data alone, without knowing which channel the field is mapped to.
Channel-specific resolve functions (tickConstraint, reversed, nice, colorScheme,
interpolation, stackable) are exported from the same file but called by
`resolveChannelSemantics()` in Stage 2.

```
resolveFieldSemantics(annotation, fieldName, values)
    │
    ├── normalizeAnnotation(annotation)
    │     → { semanticType, intrinsicDomain?, unit?, sortOrder? }
    │
    ├── resolveTiers(semanticType)           // internal — determines which rules fire
    │     → { t0: T0Family, t1: T1Category | null }
    │
    ├── resolveDefaultVisType(semanticType, values)
    │     → 'quantitative' | 'ordinal' | 'nominal' | 'temporal'
    │
    ├── resolveFormat(semanticType, unit, fieldName, values)
    │     → { format: FormatSpec, tooltipFormat: FormatSpec }
    │     ├── resolveCurrencyPrefix(unit, fieldName)
    │     ├── resolveUnitSuffix(unit, fieldName)
    │     ├── detectPrecision(values)  → data-driven decimal places (0–4)
    │     └── precisionFormat(values)  → d3-format pattern from precision
    │     Note: `decimal` formatClass returns format:{} (empty — VL native)
    │
    ├── resolveAggregationDefault(semanticType)
    │     → 'sum' | 'average' | undefined
    │
    ├── resolveZeroClass(semanticType, domain)
    │     → 'meaningful' | 'arbitrary' | 'contextual'
    │     └── intrinsicDomain[0] > 0? → 'arbitrary' (1-based scale)
    │
    ├── resolveScaleType(semanticType, values)
    │     → 'linear' | 'log' | 'sqrt' | undefined
    │
    ├── resolveDomainConstraint(semanticType, domain, values)
    │     → DomainConstraint | undefined
    │     ├── annotation.intrinsicDomain provided? → use directly
    │     ├── type-intrinsic? (Lat/Lon) → use fixed bounds
    │     └── data-inferred? (Percentage) → detect from values
    │
    ├── resolveCanonicalOrder(semanticType, sortOrder, values)
    │     → string[] | undefined
    │     ├── annotation.sortOrder provided? → use directly
    │     ├── well-known type? (Month, DayOfWeek) → built-in order
    │     └── otherwise → undefined (no canonical order)
    │
    ├── resolveCyclic(semanticType, sortOrder)
    │     → boolean
    │
    ├── resolveSortDirection(semanticType)
    │     → 'ascending' | 'descending' | undefined
    │
    └── resolveBinningSuggested(semanticType, domain, values)
          → boolean
          └── domain span ≤ 20? → false
```

**Functions exported from field-semantics.ts but called by Stage 2 (`resolveChannelSemantics`):**

```
resolveTickConstraint(semanticType, domain, values)                → TickConstraint | undefined
resolveReversed(semanticType)                                       → boolean
resolveNice(semanticType, domainShape)                              → boolean
getRecommendedColorSchemeWithMidpoint(type, vlType, values, field)  → ColorSchemeRecommendation
resolveInterpolation(semanticType)                                  → Interpolation | undefined
resolveStackable(semanticType)                                      → 'sum' | 'normalize' | false
```

These require channel context (encoding type, axis direction, mark type) and are
therefore not part of `FieldSemantics`.

### 6.3 Caching

The field context is expensive to compute (data scanning for format detection, distribution analysis for scale type). It should be built once per field per dataset and cached:

```typescript
/** Cache key: `${fieldName}::${semanticType}::${dataHash}` */
const contextCache = new Map<string, FieldSemantics>();
```

The data hash can be a fast fingerprint of the first 100 values to avoid recomputation when the same data is reused.

---

## §7 Integration: Four-Stage Pipeline

The chart engine follows a four-stage compilation pipeline inspired by
LLVM's architecture. `ChannelSemantics` serves as the IR — the stable
contract between frontend (semantic resolution) and backend (spec generation).

```
┌──────────────────────────────────────────────────────────────────────┐
│  Stage 1: Field Semantics                                            │
│  resolveFieldSemantics(annotation, fieldName, values)                │
│  → FieldSemantics (data identity: format, agg, domain, ordering)     │
│  VL dependency: None                                                 │
├──────────────────────────────────────────────────────────────────────┤
│  Stage 2: Channel Semantics                                          │
│  resolveChannelSemantics(encodings, data, semanticTypes, converted)   │
│  → ChannelSemantics (encoding type, color scheme, temporal format,    │
│    tick constraints, axis reversal, nice, interpolation, stacking)    │
│  Calls Stage 1 internally per field, then promotes into flat struct   │
│  VL dependency: None                                                 │
├──────────────────────────────────────────────────────────────────────┤
│  IR boundary: ChannelSemantics (flat, target-agnostic)               │
├──────────────────────────────────────────────────────────────────────┤
│  Stage 3: Layout                                                     │
│  computeLayout(channelSemantics, declaration, data, canvasSize, opts) │
│  → LayoutResult (subplot sizes, step widths, facet grid)             │
│  Also: convertTemporalData, declareLayoutMode, filterOverflow        │
│  VL dependency: None                                                 │
├──────────────────────────────────────────────────────────────────────┤
│  Stage 4: Spec Generation (backend-specific)                         │
│  assembleVegaLite / assembleECharts / assembleChartjs / assembleGoFish│
│  → Backend-native spec (VL JSON / ECharts option / CJS config / GF)  │
│  Also: finalize zero-baseline, template.instantiate, apply layout    │
│  VL dependency: Yes (only this stage)                                │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.1 Stage 1–2: Semantic resolution

Stage 2 is the public entry point. It calls Stage 1 internally per field,
then layers on channel-specific decisions:

```
resolveChannelSemantics(encodings, data, semanticTypes, convertedData?)
    → for each channel:

        // Stage 1: field identity (internal)
        annotation = normalizeAnnotation(semanticTypes[field])
        fc = resolveFieldSemantics(annotation, field, values)

        // Stage 2: channel-specific decisions
        cs = {
          field, semanticAnnotation: fc.semanticAnnotation,
          type: resolveEncodingType(...),

          // promoted from FieldSemantics (data identity):
          format, tooltipFormat, aggregationDefault,
          scaleType, domainConstraint,
          canonicalOrder, cyclic, sortDirection, binningSuggested,

          // channel-resolved (NOT from FieldSemantics):
          nice: resolveNice(semanticType, domainShape),
          tickConstraint: resolveTickConstraint(semanticType, domain, values),
          reversed: resolveReversed(semanticType),
          colorScheme: resolveColorScheme(semanticType, annotation, values),
          temporalFormat: resolveTemporalFormat(...),
          ordinalSortOrder: resolveOrdinalSortOrder(...),
          interpolation: resolveInterpolation(semanticType),
          stackable: resolveStackable(semanticType),
        }

    → Record<channel, ChannelSemantics>
```

**Key design decision:** Stage 2 does NOT resolve `zero` (zero-baseline).
The zero decision requires knowing the template's mark type (bar → include
zero for length integrity; scatter → data-fitted), which is Stage 4
knowledge. Stage 2 provides `zeroClass` (from FieldSemantics) as a hint;
Stage 4 finalizes `cs.zero` using `computeZeroDecision()`.

**Temporal data conversion:** `convertTemporalData()` runs once in the
assembler, before calling `resolveChannelSemantics()`. The converted data
is passed as the optional `convertedData` parameter for temporal format
detection, and reused by Stages 3–4 for filtering and layout.

`FieldSemantics` is internal — never exposed downstream. All properties
are promoted into the flat `ChannelSemantics` interface.

### 7.2 ChannelSemantics: the IR

`ChannelSemantics` is the **sole public interface** consumed by all
assemblers, templates, layout, and recommendation. Field-level properties
are **promoted** directly into the struct during Stage 2.

```typescript
interface ChannelSemantics {
    // --- Identity ---
    field: string;
    semanticAnnotation: SemanticAnnotation;

    // --- Encoding type ---
    type: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';

    // --- Formatting ---
    format?: FormatSpec;
    tooltipFormat?: FormatSpec;
    temporalFormat?: string;

    // --- Aggregation ---
    aggregationDefault?: 'sum' | 'average';

    // --- Scale ---
    zero?: ZeroDecision;           // finalized by Stage 4, not Stage 2
    scaleType?: 'linear' | 'log' | 'sqrt' | 'symlog';
    nice?: boolean;
    domainConstraint?: DomainConstraint;
    tickConstraint?: TickConstraint;

    // --- Ordering ---
    ordinalSortOrder?: string[];
    cyclic?: boolean;
    reversed?: boolean;
    sortDirection?: 'ascending' | 'descending';

    // --- Color ---
    colorScheme?: ColorSchemeRecommendation;

    // --- Line chart ---
    interpolation?: 'linear' | 'step' | 'step-after' | 'monotone';

    // --- Histogram ---
    binningSuggested?: boolean;

    // --- Stacking ---
    stackable?: 'sum' | 'normalize' | false;
}
```

### 7.3 Stage 3: Layout (target-agnostic)

Stage 3 operates entirely on `ChannelSemantics` and data — no backend knowledge:

```
// Pre-stage: once per assembly
convertedData = convertTemporalData(data, semanticTypes)

// Template hook (narrow interface for backend → layout communication)
declaration = chartTemplate.declareLayoutMode(channelSemantics, data, props)

// Overflow filtering
budgets = computeChannelBudgets(channelSemantics, declaration, convertedData, ...)
overflowResult = filterOverflow(channelSemantics, declaration, encodings, convertedData, ...)

// Layout sizing
layoutResult = computeLayout(channelSemantics, declaration, filteredData, canvasSize, ...)
```

`declareLayoutMode` is a template hook analogous to LLVM's `TargetTransformInfo` —
it lets the backend (Stage 4) influence middle-end (Stage 3) decisions through
a narrow, well-defined interface (e.g., "I use binned axes" → affects layout sizing).

### 7.4 Stage 4: Spec generation (backend-specific)

Each backend assembler performs:

1. **Zero-baseline finalization** — reads `zeroClass` from `ChannelSemantics`,
   combines with template mark type, calls `computeZeroDecision()`:
   ```typescript
   // In each assembler, after resolveChannelSemantics():
   const effectiveMarkType = templateMarkType || 'point';
   for (const [channel, cs] of Object.entries(channelSemantics)) {
       if ((channel === 'x' || channel === 'y') && cs.type === 'quantitative') {
           cs.zero = computeZeroDecision(
               cs.semanticAnnotation.semanticType, channel,
               effectiveMarkType, numericValues,
           );
       }
   }
   ```

2. **Encoding translation** — `buildVLEncodings()` / ECharts series config / etc.
3. **Template instantiation** — `template.instantiate(vgObj, context)`
4. **Layout application** — `vlApplyLayoutToSpec()` / `ecApplyLayoutToSpec()` / etc.
5. **Post-layout adjustments** — facet refinement, tooltips, independent scales

The `InstantiateContext` passed to templates contains `channelSemantics`,
`layout`, `table`, `resolvedEncodings`, `canvasSize`, and `assembleOptions`.
Templates read the flat `ChannelSemantics` directly — no nested types.

### 7.5 Recommendation engine impact

The recommendation engine (`recommendation.ts`) currently uses:
- `isMeasureType()`, `isTimeSeriesType()`, `isCategoricalType()`, etc.

With the flat `ChannelSemantics`, recommendation can also use:
- `cs.aggregationDefault` to auto-populate aggregate in encodings
- `cs.stackable` to decide whether to suggest stacked variants
- `cs.binningSuggested` to suggest histogram for continuous fields
- `cs.semanticAnnotation` for type identity when needed

These don't require API changes — the recommendation functions can optionally
accept channel semantics and use them for better scoring.

---

## §8 SemanticResult: Updated Structure

```typescript
/**
 * Stage 2 output.
 *
 * A flat Record<channel, ChannelSemantics>.  Each entry contains all
 * resolved decisions — no separate FieldSemantics map needed because
 * those properties are promoted directly into the struct.
 */
type SemanticResult = Record<string, ChannelSemantics>;
```

---

## §9 Worked Examples

### Example 1: Revenue bar chart (with currency annotation)

**Input:**
- Field: `revenue`, Annotation: `{ semanticType: "Revenue", unit: "EUR" }`
- Data: [124500, 89200, 450000, 312000, ...]
- Channel: Y, Mark: bar

**resolveFieldSemantics output:**
```json
{
    "semanticAnnotation": { "semanticType": "Revenue", "unit": "EUR" },
    "defaultVisType": "quantitative",
    "format": { "pattern": "€,.0f", "prefix": "€", "abbreviate": true },
    "tooltipFormat": { "pattern": "€,.2f", "prefix": "€" },
    "aggregationDefault": "sum",
    "zeroClass": "meaningful",
    "scaleType": "linear",
    "domainConstraint": null,
    "canonicalOrder": null,
    "cyclic": false,
    "sortDirection": null,
    "binningSuggested": true
}
```

**Channel-resolved additions (by resolveChannelSemantics):**
`nice: true`, `reversed: false`, `tickConstraint: null`,
`colorScheme: { type: 'sequential', scheme: 'goldgreen' }`,
`interpolation: 'monotone'`, `stackable: 'sum'`

**Result:** Y axis shows "€0", "€100K", "€200K", ...; zero-baseline included; tooltip shows "€124,500.00"; bars are summable via stacking. Note: `unit: "EUR"` → `prefix: "€"` mapping. Precision is data-driven: `detectPrecision([124500, 89200, ...])` → 0 → `€,.0f`.

### Example 2: Temperature line chart (with unit annotation)

**Input:**
- Field: `avg_temp`, Annotation: `{ semanticType: "Temperature", unit: "°C" }`
- Data: [16.8, 18.4, 22.1, 25.8, 29.6, 31.7, 33.1, 31.5, ...]
- Channel: Y, Mark: line

**resolveFieldSemantics output:**
```json
{
    "semanticAnnotation": { "semanticType": "Temperature", "unit": "°C" },
    "defaultVisType": "quantitative",
    "format": { "pattern": ".1f", "suffix": "°C" },
    "tooltipFormat": { "pattern": ".2f", "suffix": "°C" },
    "aggregationDefault": "average",
    "zeroClass": "arbitrary",
    "scaleType": "linear",
    "domainConstraint": null,
    "canonicalOrder": null,
    "cyclic": false,
    "sortDirection": null,
    "binningSuggested": true
}
```

**Channel-resolved additions:**
`nice: true`, `reversed: false`, `tickConstraint: null`,
`colorScheme: { type: 'diverging', midpoint: 0, scheme: 'blueorange' }`,
`interpolation: 'monotone'`, `stackable: false`

**Result:** Y axis data-fitted (no 0°C baseline — zero is arbitrary for temperature); ticks show "16°C", "20°C", "25°C", "30°C"; tooltip shows "16.80°C"; diverging color midpoint at 0°C (freezing point, meaningful for Celsius); smooth monotone interpolation. Precision data-driven: `detectPrecision([16.8, 18.4, ...])` → 1 → `.1f`.

### Example 3: Rank bump chart

**Input:**
- Field: `rank`, SemanticType: `Rank`
- Data: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
- Channel: Y, Mark: line (bump)

**resolveFieldSemantics output:**
```json
{
    "semanticAnnotation": { "semanticType": "Rank" },
    "defaultVisType": "ordinal",
    "format": { "pattern": "d" },
    "tooltipFormat": { "pattern": "d" },
    "aggregationDefault": null,
    "zeroClass": "arbitrary",
    "scaleType": "linear",
    "domainConstraint": null,
    "canonicalOrder": null,
    "cyclic": false,
    "sortDirection": "ascending",
    "binningSuggested": false
}
```

**Channel-resolved additions:**
`nice: false`, `reversed: true`, `tickConstraint: { integersOnly: true, minStep: 1 }`,
`colorScheme: { type: 'sequential', reversed: true }`,
`interpolation: 'step'`, `stackable: false`

**Result:** Y axis reversed (1 at top); integer ticks only; no zero; step interpolation; no stacking.

### Example 4: Month categorical axis

**Input:**
- Field: `month`, SemanticType: `Month`
- Data: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", ...]
- Channel: X, Mark: bar

**resolveFieldSemantics output:**
```json
{
    "semanticAnnotation": { "semanticType": "Month" },
    "defaultVisType": "ordinal",
    "format": {},
    "tooltipFormat": {},
    "aggregationDefault": null,
    "zeroClass": null,
    "scaleType": null,
    "domainConstraint": null,
    "canonicalOrder": ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                       "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "cyclic": true,
    "sortDirection": "ascending",
    "binningSuggested": false
}
```

**Channel-resolved additions:**
`reversed: false`, `ordinalSortOrder: ["Jan", "Feb", ...]` (from canonicalOrder),
`colorScheme: null`, `interpolation: null`, `stackable: false`

**Result:** X axis sorts months in calendar order (not alphabetical); ordinal type; cyclic; no binning.

### Example 5: Percentage in scatter plot (with representation detection)

Percentage data comes in two common representations that require different formatting:
- **Fractional (0–1):** values like 0.48, 0.51 — d3's `.%` format multiplies by 100 automatically
- **Whole-number (0–100):** values like 48, 51 — need `.f` + "%" suffix, no multiplication

The builder **infers the representation from data values**: if `max(values) ≤ 1.0` (and most values are in [0,1]), it's fractional; if values are in [0,100] range, it's whole-number. The LLM can also provide `domain: [0, 1]` or `domain: [0, 100]` to disambiguate explicitly.

**Example 5a: Fractional percentage (0–1)**

**Input:**
- Field: `completion_rate`, SemanticType: `Percentage`
- Data: [0.48, 0.49, 0.51, 0.52, 0.50, 0.47, ...]
- Channel: Y, Mark: point

**resolveFieldSemantics output:**
```json
{
    "semanticAnnotation": { "semanticType": "Percentage" },
    "defaultVisType": "quantitative",
    "format": { "pattern": ".1p%" },
    "tooltipFormat": { "pattern": ".2p%" },
    "aggregationDefault": "average",
    "zeroClass": "contextual",
    "scaleType": "linear",
    "domainConstraint": { "min": 0, "max": 1, "clamp": false },
    "canonicalOrder": null,
    "cyclic": false,
    "sortDirection": null,
    "binningSuggested": true
}
```

**Channel-resolved additions:**
`nice: true`, `reversed: false`, `colorScheme: { type: 'sequential' }`,
`interpolation: 'monotone'`, `stackable: 'normalize'`

Note: d3's `.1%` format handles the ×100 conversion: `0.48` → `"48.0%"`. Precision data-driven.

**Example 5b: Whole-number percentage (0–100)**

**Input:**
- Field: `pass_rate`, SemanticType: `Percentage`
- Data: [85, 92, 78, 91, 88, ...]
- Channel: Y, Mark: bar

**resolveFieldSemantics output:**
```json
{
    "semanticAnnotation": { "semanticType": "Percentage" },
    "defaultVisType": "quantitative",
    "format": { "pattern": "d", "suffix": "%" },
    "tooltipFormat": { "pattern": ".1f", "suffix": "%" },
    "aggregationDefault": "average",
    "zeroClass": "contextual",
    "scaleType": "linear",
    "domainConstraint": { "min": 0, "max": 100, "clamp": false },
    "canonicalOrder": null,
    "cyclic": false,
    "sortDirection": null,
    "binningSuggested": false
}
```

**Channel-resolved additions:**
`nice: true`, `reversed: false`, `colorScheme: { type: 'sequential' }`,
`interpolation: null`, `stackable: 'normalize'`

Note: here `suffix: "%"` is explicit and the pattern is plain `d` (integer, no ×100). `85` → `"85%"`. Precision data-driven: `detectPrecision([85, 92, ...])` → 0.

**Channel override (5a):** Since data is clustered at 0.47–0.52 (proximity = 0.47/0.52 ≈ 0.90 > 0.3) and mark is point (not bar), `computeZeroDecision` returns `zero: false`. Axis zooms to ~46%–53%.

### Example 6: Rating bar chart (with domain annotation)

**Input:**
- Field: `rating`, Annotation: `{ semanticType: "Rating", domain: [1, 5] }`
- Data: [4, 3, 5, 2, 4, 5, 3, 4, ...]
- Channel: Y, Mark: bar

**resolveFieldSemantics output:**
```json
{
    "semanticAnnotation": { "semanticType": "Rating", "intrinsicDomain": [1, 5] },
    "defaultVisType": "quantitative",
    "format": {},
    "tooltipFormat": { "pattern": ".1f" },
    "aggregationDefault": "average",
    "zeroClass": "arbitrary",
    "scaleType": "linear",
    "domainConstraint": { "min": 1, "max": 5, "clamp": false },
    "canonicalOrder": null,
    "cyclic": false,
    "sortDirection": null,
    "binningSuggested": false
}
```

**Channel-resolved additions:**
`nice: false` (bounded domainShape), `reversed: false`,
`tickConstraint: { integersOnly: true, exactTicks: [1, 2, 3, 4, 5], minStep: 1 }`,
`colorScheme: { type: 'sequential' }`, `interpolation: null`, `stackable: false`

Note: `format: {}` (empty) — VL handles axis formatting natively for Rating.
`tooltipFormat` uses data-driven precision for the popup.

**Key derivations from `domain: [1, 5]`:**
- `domainConstraint`: axis range fixed to 1–5
- `zeroClass: "arbitrary"`: domain starts at 1 (not 0), so zero is not meaningful
- `tickConstraint.exactTicks: [1,2,3,4,5]`: span = 4 ≤ 20, so every integer gets a tick (channel-resolved)
- `binningSuggested: false`: only 5 possible values, binning is useless
- `nice: false`: bounded domain shape → don't extend to "nice" numbers (channel-resolved)
- **Mark-aware zero**: For bar marks, despite `zeroClass: 'arbitrary'`, the Stage 4 assembler
  keeps `scale.zero = true` for proportional bar lengths (bars grow from 0, VL auto-extends to [0,5]).
  For scatter/line marks, `scale.zero` is cleared and the axis stays [1,5].

---

## §10 Migration Plan

### Phase A: Type system foundation (non-breaking)

1. Define `SemanticAnnotation` interface in `types.ts` (see §3.2)
2. Add `normalizeAnnotation()` to accept both bare strings and enriched objects
3. Update `semantic_types` field type in `ChartAssemblyInput` to `Record<string, string | SemanticAnnotation>`
4. Implement `resolveFieldSemantics()` in `field-semantics.ts` (Stage 1)
5. Implement all `resolve*()` sub-functions, with annotation.intrinsicDomain / annotation.unit flowing in
6. Add `FieldSemantics` to `types.ts`
7. Promote `FieldSemantics` properties into flat `ChannelSemantics`
8. In `resolveChannelSemantics` (Stage 2), call `resolveFieldSemantics` and promote properties into each channel

**Phase A also includes updating the Python-side LLM prompt:**
9. Update `generate_semantic_types_prompt()` in `semantic_types.py` to request `intrinsic_domain` and `unit` for applicable types
10. Update `SYSTEM_PROMPT` in `agent_data_load.py` to show the enriched JSON format
11. Add backward-compatible parsing: accept both old `"Rating"` and new `{ "semantic_type": "Rating", "domain": [1, 5] }` formats

**No existing behavior changes.** The context is computed but not yet consumed.

### Phase B: Consume context in VL assembler (Stage 4)

1. In `vlApplyLayoutToSpec`, read `cs.format` → apply `axis.format`
2. Read `cs.tickConstraint` → apply `axis.tickMinStep`, `axis.values`
3. Read `cs.reversed` → apply `scale.reverse`
4. Read `cs.domainConstraint` → apply `scale.domain` + `scale.clamp`
5. Read `cs.nice` → apply `scale.nice`

**Existing zero/color/temporal/sort logic continues to work.** New properties layer on top.

### Phase C: Consume context in ECharts assembler (Stage 4)

Same as Phase B but translating to ECharts API (`axisLabel.formatter`, `yAxis.inverse`, etc.).

### Phase D: Consume context in recommendation engine

1. Use `cs.aggregationDefault` when auto-populating encodings
2. Use `cs.stackable` in stacked chart suitability checks
3. Use `cs.binningSuggested` in histogram recommendation

### Phase E: Consolidate existing decisions

1. `computeZeroDecision` reads `zeroClass` from `ChannelSemantics`; finalized in Stage 4 by each assembler
2. Move `getRecommendedColorScheme` to read from `cs.colorScheme` (promoted from FieldSemantics)
3. Move `inferOrdinalSortOrder` to read from `cs.ordinalSortOrder` (promoted from FieldSemantics)
4. Move temporal format resolution to `cs.temporalFormat` (promoted from FieldSemantics)

After this phase, all semantic-type-driven decisions flow through the flat `ChannelSemantics` IR. No downstream code directly imports `isMeasureType()`, `isTimeSeriesType()`, etc. for decision-making.

---

## §11 Open Questions

1. **Unit/domain annotation reliability.** How reliably will the LLM provide `domain` and `unit`? Mitigation strategies:
   - (a) Require domain/unit for a small set of types (Rating, Score, Temperature, Price) — reject annotations without them
   - (b) Treat domain/unit as best-effort hints — fall back gracefully to data-inferred or type-intrinsic defaults (current proposal)
   - (c) Prompt the user to confirm/correct LLM-provided annotations in certain cases
   - Fallback priority: annotation.unit > column-name heuristics ("Weight (kg)") > data scan ("$1,234") > type defaults
   - Note: `intrinsicDomain` replaces the old `domain` property for clarity

2. **Scale type auto-detection.** Should we auto-switch to log scale when data spans >2 orders of magnitude? This is powerful but can surprise users. Options:
   - (a) Never auto-switch; provide `scaleType` as a hint for recommendation only
   - (b) Auto-switch with a prominent UI indicator ("Log scale applied")
   - (c) Auto-switch only for specific types (Revenue, Population) where log is commonly expected

3. **Reversed axis scope.** Rank reversal on Y makes sense, but what about X? A horizontal bump chart with rank on X should also reverse. Should `reversed` be axis-aware or axis-agnostic?
   - Current proposal: axis-agnostic (template/backend decides how to apply)

4. **Format vs. LLM context.** Should the compilation context's format information be passed to the LLM when generating chart code? This could help the LLM produce better Python/JS code that formats values correctly. But it adds token overhead.

5. **Interaction with explicit user overrides.** When the user manually sets an axis format or domain, how does that interact with the compilation context?
   - Proposed: User overrides always win. The context provides defaults; any explicit setting in `ChartEncoding` or `chartProperties` takes precedence.

6. **Where does `resolveFieldSemantics` live?** *(Resolved)*
   - Lives in `field-semantics.ts` (Option B) — clean separation; `semantic-types.ts` stays lean.
   - Called internally by `resolveChannelSemantics()` in `resolve-semantics.ts` (Stage 2).

---

## §12 Summary

The compilation context is a structured bridge between semantic type knowledge and visualization property configuration. Instead of sprinkling `if (semanticType === 'Revenue') { ... }` across 6 files, we build a single typed context object per field and let all downstream consumers read from it.

**What changes:**
- One new type: `SemanticAnnotation` (enriched input with optional `intrinsicDomain`, `unit`, `sortOrder`)
- One new type: `FieldSemantics` (structured output)
- One new builder: `resolveFieldSemantics(annotation, fieldName, values)`
- `ChannelSemantics` becomes flat — promotes field-semantics properties directly (no nested `fieldSemantics`)
- Dead properties removed: `aggregate`, `sortOrder`, `sortBy`, `typeReason`
- `semantic_types` map accepts both bare strings and annotation objects
- VL/ECharts assemblers gain a `vlApplyFieldContext()` step
- LLM prompts updated to request `intrinsic_domain`/`unit` for applicable types

**What stays the same:**
- The semantic type string taxonomy
- The four-stage pipeline structure (Stage 1: Field Semantics → Stage 2: Channel Semantics → Stage 3: Layout → Stage 4: Spec Generation)
- The existing zero/color/temporal/sort decisions (they migrate to read from `ChannelSemantics`)
- The recommendation engine API

**What's new:**
- Enriched semantic type annotation with optional `intrinsicDomain`, `unit`, and `sortOrder` metadata
- Field-aware formatting (axis ticks, tooltips, data labels) driven by annotation
- Aggregation defaults per semantic type
- Tick constraints (integer-only, exact ticks)
- Reversed axes for rank-like types
- Domain clamping for bounded types
- Scale type hints (log, sqrt)
- Interpolation hints for line charts
- Binning and stacking compatibility flags
- Diverging midpoint resolution from unit, type, intrinsicDomain, or data
- Cyclic domain support for wrap-around ordinals (seasons, compass directions)
