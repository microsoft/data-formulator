# Agents-Chart: Automatic Layout Design

> Design overview for the `agents-chart` assembler — a visualization library
> designed for AI agents that compiles high-level chart specifications into
> Vega-Lite. For full details see
> [design-stretch-model.md](design-stretch-model.md) and
> [design-semantic-types.md](design-semantic-types.md).

---

## Motivation

### The problem with LLM-generated visualization

Using LLMs to generate Vega-Lite (or similar low-level specifications)
directly has fundamental limitations:

1. **Inconsistency.** LLMs produce variable output quality — incorrect
   encodings, broken layouts, and poor aesthetic defaults. Weaker models
   struggle with anything beyond basic charts; even strong models fail on
   composition, faceting, and layered designs.

2. **Simplicity–quality trade-off.** Simple generated code is easy for
   users to understand and edit (swap a field, change chart type) but looks
   mediocre. Complex generated code looks polished but is opaque — a user
   who just wants to visualize a different metric must go back to the LLM,
   increasing cost and breaking interaction flow.

3. **Expensive and slow.** Only frontier models can reliably produce correct
   specs for non-trivial charts, because the parameter space (axis types,
   domain settings, sizing, formatting, mark configuration) is large and
   inter-dependent.

4. **Ugly failure modes.** When generated code breaks, the chart doesn't
   degrade gracefully — it produces extreme dimensions (e.g., 10,000 px
   wide from high-cardinality facets), crashes the renderer, or shows
   unrecognizable patterns. The spec language gives only low-level errors
   that don't explain *why* the design is wrong for the given data.

### Our goal

Design a visualization library optimized for AI agents that balances:

- **Simplicity.** The spec captures only high-level semantics — chart type,
  field encodings, and data relationships. Composition, styling, axis
  configuration, and data-type handling are offloaded to the compiler.
  This makes the LLM's job easier and output more reliable.

- **Expressiveness.** The library covers both basic and non-basic charts:
  grouped bars, bump charts, streamgraphs, ridge plots, candlesticks, and
  other common business and statistical visualizations.

- **Editability without the LLM.** Only high-level knobs are exposed —
  chart type, field assignments, semantic types. When a user swaps a field
  or changes a mark type, the compiler re-derives all low-level config
  automatically and the chart still looks good. The goal: **in 90% of
  cases, the user never needs to ask the LLM again** after the initial
  chart is created.

- **Graceful failure.** When a chart has problems (encoding mismatches,
  data-shape issues), the system produces high-level semantic explanations
  of *why* the configuration is inappropriate — actionable for both the
  user and the AI agent to repair.

### Key insight: semantic types as the contract

The core challenge is that in existing languages, the semantic contract
between data and chart is scattered across low-level parameters. Consider
a column containing `17234982372` — it could be a Unix timestamp, a
monetary value, or a serial number. Today, the LLM must decide the VL
encoding type (`temporal`, `quantitative`, `nominal`), set axis formatting,
configure zero-baseline behavior, choose sizing — and these become
hard-coded constants that break when the user edits anything.

**Our observation:** instead of asking the LLM to set these low-level
details every time, we ask it to communicate one thing: **what does this
data mean?** — expressed through a fine-grained semantic type system
(e.g., `Revenue`, `Rank`, `Temperature`, `Year`). From the semantic type
plus data characteristics (cardinality, range, distribution), the compiler
automatically derives:

- VL encoding type (quantitative / ordinal / nominal / temporal)
- Zero-baseline decision (Revenue → include zero; Temperature → don't)
- Domain padding (Rank → 8% pad so rank 1 isn't crushed against the axis)
- Axis sizing (spring model for discrete, per-axis stretch for continuous)
- Formatting, color schemes, and sort order

When the user changes a field or chart type, the compiler re-runs these
derivations with the new inputs. No LLM call needed — the semantic types
from the original generation carry the information forward.

### The workflow

```
1. AI agent generates:  chart spec  +  semantic types for each field
                         (small JSON)    (e.g., Revenue, Year, Company)

2. User edits chart:    swap field / change mark type / add facet
   └─→ Compiler re-derives all config from semantic types
   └─→ Chart looks good automatically  (90% of edits)

3. (Optional) Fine-tune: user asks LLM to edit underlying Vega-Lite
                          for detailed style customization  (10% of edits)
```

The chart spec is intentionally minimal — in Data Formulator, it's a small
JSON object returned alongside the data transformation code, so that
precious tokens go where they matter most: data computation and
transformation, not visualization configuration.

### What this document covers

Two systems make this possible:

1. **Automatic axis sizing** (§1–§2) — physics-based models that compute
   chart dimensions from data density, so the layout adapts to any data
   without manual sizing.
2. **Semantic type system** (§3) — a type hierarchy that encodes data
   meaning, driving encoding-type decisions, zero-baseline behavior, and
   domain configuration.

---

## §1  Discrete Axis Sizing: Spring Model

**Applies to:** bar, histogram, heatmap, boxplot, grouped bar — any axis
with banded items (one slot per category/bin).

### Core idea

Model the axis as a box containing $N$ springs. Each spring (item) wants its
natural length $\ell_0$ (the ideal step size, ~20 px). The box (axis) resists
growing beyond its rest length $L_0$ (the canvas size). When $N \cdot \ell_0 > L_0$,
the system finds an equilibrium:

$$\ell = \frac{\kappa \cdot \ell_0 + L_0 / N}{1 + \kappa}$$

where $\kappa = k_{\text{item}} / k_{\text{wall}}$ controls how the
compression is split between shrinking items and stretching the axis.

### Three regimes

| Regime | Condition | Behavior |
|--------|-----------|----------|
| **Fits** | $N \cdot \ell_0 \leq L_0$ | No action; items at natural size |
| **Elastic** | Items overflow but can be accommodated | Items compress + axis stretches to equilibrium |
| **Overflow** | $N \cdot \ell_{\min} > L_{\max}$ | Items at minimum size, axis at max; excess items truncated |

### Key parameters

| Parameter | Meaning | Typical default |
|-----------|---------|-----------------|
| $\ell_0$ | Natural step size | 20 px (varies by mark) |
| $\ell_{\min}$ | Minimum step size | 6 px |
| $\kappa$ | Stiffness ratio (items vs. wall) | 1.0 |
| $\beta$ | Max stretch ratio | 1.0 (→ up to 2× canvas) |

Different marks have different physics: a bar ($\kappa = 1.0$) resists
compression more than a histogram bin ($\kappa = 0.6$) because bar width
directly encodes value. A heatmap cell ($\kappa = 2.0$) is even stiffer —
color needs area to be perceivable.

### Extensions

- **Grouped bars**: the group (not the sub-bar) is the spring unit;
  $\ell_0 = m \cdot 20$ for $m$ sub-bars.
- **Faceted charts**: a second stretch factor $\beta_f$ governs the overall
  canvas; each subplot then runs its own spring model internally.

---

## §2  Continuous Axis Sizing: Per-Axis Stretch

**Applies to:** scatter, line, area, streamgraph, bump chart — any axis
where marks float at data-determined positions rather than occupying fixed bands.

### Core idea

Springs don't apply because continuous marks don't own slots — 10 points
and 1000 points can both exist in the same canvas. The problem is **density**,
not allocation.

Each axis is stretched independently based on 1D crowding pressure:

$$s = \min\!\big(1 + \beta_c,\; p^{\,\alpha_c}\big)$$

where $p$ is the pressure ratio (how much mark cross-section competes for
pixels along that axis) and $\alpha_c$ is an elasticity exponent.

### Two pressure modes

| Mode | Pressure formula | When used |
|------|------------------|-----------|
| **Positional** | $p = \text{uniquePixelPositions} \cdot \sqrt{\sigma} \;/\; \text{dim}_0$ | Default for both axes |
| **Series-count** | $p = n_{\text{series}} \cdot \sigma \;/\; \text{dim}_0$ | Line/area Y axis — series overlap is the dominant crowding signal |

**Why two modes?** On a line chart, Y-axis crowding comes from overlapping
series (5 lines piled up), not from the number of unique Y values. Positional
counting would miss correlated series that map to the same Y pixels.
Series-count captures the right signal: "how many lines compete for this
vertical space?"

### Per-chart-type cross-sections

| Chart | $\sigma_x$ | $\sigma_y$ | Series axis |
|-------|-----------|-----------|-------------|
| Scatter | 30 | 30 | — |
| Line / Area | 100 | 20 | Y (auto) |
| Bump | 80 | 20 | Y (auto) |
| Stacked bar | 20 | 20 | Y (auto) |

The asymmetric cross-sections reflect real visual needs: on a line chart,
each date tick needs ~10 px of X space ($\sqrt{100}$), while each series
needs ~20 px of Y separation.

### Positional ≥ Series constraint

For multi-series line/area charts, stretching the positional axis (X)
also reduces visual overlap between series. So the positional axis stretches
at least as much as the series axis:

$$s_x = \max(s_x^{\text{positional}},\; s_y^{\text{series}})$$

### Why different marks → different sizes

Switching a line chart to a scatter plot changes the stretch because the
marks have genuinely different spatial needs. Lines are 1D marks that share
structure (all series share the same X positions); scatter points are 2D
marks that need individual separation. The size change reflects a real
difference in readability requirements — not a bug.

---

## §3  Semantic Types

**Problem:** Vega-Lite decides encoding type and zero-baseline from the mark,
not the data. A scatter plot of Revenue defaults to `zero: false`, truncating
bars of meaning. A bar chart of Temperature defaults to `zero: true`, wasting
space for a metric with no meaningful zero.

### Type hierarchy

Semantic types classify fields by what they *mean*, organized in a lattice:

```
             AnyType
          ┌────┼────────┐
       Temporal  Numeric  Categorical
       ┌──┴──┐  ┌──┴──┐  ┌──┴──┐
     Point Granule Measure Discrete Entity Coded
       │      │      │       │       │      │
   DateTime  Year  Revenue  Rank   Person Status
   Date     Month  Count    Index  Company Boolean
   Time      Day   Price    Score  Product  ...
              …     …        …
```

Each type maps to a **VisCategory** → VL encoding type:

| Branch | VisCategory | Examples |
|--------|-------------|----------|
| Temporal Point | temporal | DateTime, Date, Year |
| Temporal Granule | ordinal | Month, Quarter, Day |
| Measure | quantitative | Revenue, Count, Temperature |
| Discrete Numeric | ordinal / nominal | Rank, Index, ID |
| Entity | nominal | Person, Company, Product |
| Coded | nominal | Status, Boolean |

### Zero-baseline decision

The most consequential semantic decision: should a quantitative axis
include zero?

**Three classes:**

| Class | Rule | Example types |
|-------|------|---------------|
| **Zero-meaningful** | 0 = absence; always include zero | Count, Revenue, Quantity, Distance, Weight |
| **Zero-arbitrary** | 0 is meaningless; data-fit the axis | Temperature, Year, Rank, Latitude |
| **Zero-contextual** | Depends on data range + mark | Percentage, Score, Rating |

**Priority:** semantic type > mark type > data range > VL default.

A Revenue scatter plot is zero-based (even though VL defaults scatter to
`zero: false`) because 0 revenue is meaningful. A Temperature bar chart is
*not* zero-based (even though VL defaults bars to `zero: true`) because 0°F
is arbitrary.

For contextual types, the **proximity heuristic** decides:

$$\text{proximity} = \frac{\min(\text{data})}{\max(\text{data})}$$

- proximity < 0.3 → include zero (data is close to it)
- proximity ≥ 0.3 + bar/area → include zero (bar length integrity)
- proximity ≥ 0.3 + other marks → data-fit (zoom in on variation)

### Domain padding

When `zero: false`, edge values sit on the axis frame. A small per-type
padding fraction pushes the domain out:

| Type | Pad | Effect |
|------|-----|--------|
| Rank, Index | 0.08 | Rank 1 gets breathing room; no misleading "0" tick |
| Score, Rating | 0.05 | Room for edge labels |
| Year | 0.03 | Tight framing, years are dense |
| Lat / Lon | 0.02 | Maps need minimal padding |
| Default | 0.05 | Safe general-purpose |

---

## How They Work Together

The three systems compose in a pipeline:

```
Data fields
  │
  ├─── Semantic type inference
  │       → VisCategory → VL encoding type
  │       → ZeroDecision → scale.zero + domain padding
  │
  ├─── Axis classification (§0)
  │       → Banded (discrete)?  → Spring model (§1)
  │       → Non-banded?         → Per-axis stretch (§2)
  │
  └─── Final VL spec
          width/height, step sizes, scale domains
```

**Example: Multi-series line chart (5 companies × 100 months of Revenue)**

1. **Semantic types.** Revenue → quantitative, zero-meaningful → `zero: true`.
   Month → temporal.
2. **Axis classification.** X = temporal non-banded, Y = quantitative
   non-banded → both use §2 gas pressure.
3. **Per-axis stretch.**
   - X (positional): 100 unique date positions, $\sigma_x = 100$ → $p = 100 \cdot 10 / 400 = 2.5$ → stretch 1.30.
   - Y (series-count): 5 series, $\sigma_y = 20$ → $p = 5 \cdot 20 / 320 = 0.31$ → stretch 1.0 (no stretch).
   - Positional ≥ Series: $1.30 \geq 1.0$ ✓, no adjustment.
4. **Final size.** 400 × 1.30 = 520 px wide, 320 px tall. The chart is
   wider to give the 100 dates room, but doesn't grow vertically because
   5 series fit comfortably.

**Example: Category bar chart (80 products)**

1. **Semantic types.** Product → nominal. Revenue → quantitative,
   zero-meaningful → `zero: true`.
2. **Axis classification.** X = nominal → banded → §1 spring model.
3. **Spring model.** $N = 80$, $\ell_0 = 20$, $L_0 = 400$.
   Ideal = 1600 > 400 → Regime 3.
   With $\kappa = 1.0$: $\ell = (20 + 5) / 2 = 12.5$ px → $L = 1000$ px.
   Clamped at $L_{\max} = 800$ → $\ell = 10$ px.
4. **Final size.** 800 px wide, 320 px tall. Each bar gets 10 px — compressed
   but readable.

---

## Comparison: Agents-Chart vs. Raw Vega-Lite

### 1. Basic charts that "just look good"

**Task:** Bar chart of Revenue by Product (80 products).

<table>
<tr><th>Agents-Chart input</th><th>Equivalent Vega-Lite (what LLM must produce)</th></tr>
<tr>
<td>

```json
{
  "chartType": "Bar Chart",
  "encodings": {
    "x": { "field": "Product" },
    "y": { "field": "Revenue" }
  },
  "semanticTypes": {
    "Product": "Company",
    "Revenue": "Revenue"
  }
}
```

</td>
<td>

```json
{
  "width": 800,
  "height": 320,
  "data": { "values": "..." },
  "mark": { "type": "bar" },
  "encoding": {
    "x": {
      "field": "Product",
      "type": "nominal",
      "sort": "-y",
      "axis": { "labelAngle": -45 }
    },
    "y": {
      "field": "Revenue",
      "type": "quantitative",
      "scale": { "zero": true },
      "axis": { "format": "~s" }
    }
  }
}
```

</td>
</tr>
</table>

With agents-chart, the LLM writes **7 lines of semantic intent**. The
compiler derives everything else:

| Decision | How the compiler decides | VL equivalent the LLM would have to guess |
|----------|-------------------------|-------------------------------------------|
| Width = 800 px | Spring model: 80 items × 20 px > 400 → elastic equilibrium | `"width": 800` (hard-coded, breaks if data changes) |
| `zero: true` | Revenue → zero-meaningful | `"scale": { "zero": true }` |
| `type: "nominal"` | Company → nominal | `"type": "nominal"` |
| Sort descending | Default for nominal × quantitative | `"sort": "-y"` |
| Label angle | Auto from label count + length | `"axis": { "labelAngle": -45 }` |

If the LLM hard-codes `"width": 800` for 80 products, the chart breaks
when the user filters to 5 products (huge empty bars) or expands to 200
(unreadable). The spring model adapts automatically.

### 2. Semantic exploration without the LLM

#### Why editing Vega-Lite is hard — even for simple field swaps

Consider what happens when a user takes a working bar chart of
**Revenue by Product** (80 products, nominal X, quantitative Y) and wants
to swap fields. This feels like it should be a one-click operation, but in
Vega-Lite each swap silently invalidates multiple interdependent parameters:

**Swapping the Y axis (metric):**

| Swap Y to… | What must change in the VL spec | Why |
|------------|-------------------------------|-----|
| **Temperature** (quantitative, zero-arbitrary) | `scale.zero`: true→false; add `scale.domain` with 5% padding; update `axis.format` (drop currency format); possibly adjust `height` if range is narrow | 0°F is meaningless — the chart wastes 60% of vertical space on empty range if zero is kept |
| **Rank** (ordinal, discrete, low cardinality) | `type`: quantitative→ordinal; `scale.zero`: true→false; add `scale.reverse`: true; add domain padding (8%); remove `axis.format`; change `sort` behavior | Rank 1 = best, so Y must be reversed; rank is ordinal, not quantitative; domain needs breathing room so rank 1 isn't crushed against the frame |
| **Category** (nominal, high cardinality → 50 values) | `type`: quantitative→nominal; remove `scale.zero`; chart type should arguably change from bar to heatmap or grouped layout; `height` must grow to fit 50 bands; add `axis.labelLimit`; remove numeric formatting | You've turned the Y axis from continuous to discrete — the mark type, sizing, and axis config all change |
| **Count** (quantitative, zero-meaningful) | Keep `scale.zero`: true (correct!); change `axis.format` (no currency); adjust `axis.title` | Semantically similar to Revenue but different formatting — the one case where nothing structural changes |
| **Percentage** (quantitative, contextual zero) | `scale.zero`: depends on data range; may need `axis.format`: ".0%"; if data is 48–52%, should set `zero: false` + padding for visual discrimination | Whether to include zero depends on the data distribution — can't decide from the type alone |

**Swapping the X axis (dimension):**

| Swap X to… | What must change in the VL spec | Why |
|------------|-------------------------------|-----|
| **Region** (nominal, 5 values) | `width`: 800→100 or revert to default; remove `axis.labelAngle`; update `sort`; step size can increase (5 items fit easily at 80 px each) | 80→5 categories — the chart is now absurdly wide for 5 bars if width stays at 800 px |
| **Year** (temporal, 30 values) | `type`: nominal→temporal; remove `sort: "-y"`; add `axis.format`: "%Y"; change mark from `bar` to `bar` with explicit `size` (VL doesn't auto-band on temporal); adjust `width` for 30 time points | Temporal axes need continuous scale + explicit bar sizing; VL's step-based layout doesn't work on temporal |
| **Month** (ordinal, cyclic, 12 values) | `type`: nominal→ordinal; set `sort` to month order (not alphabetical!); adjust `width` for 12 items; keep step-based layout but change step size | Without explicit sort, VL alphabetizes months: Apr, Aug, Dec, Feb… — a classic LLM mistake |
| **Country** (nominal, 200 values) | `width`: must grow dramatically; add `axis.labelAngle`: -90; add `axis.labelLimit`; consider truncation or top-N filter; step size must compress | 200 categories at 20 px = 4000 px wide — overflows any reasonable canvas |
| **Date** (temporal, 1000 daily values) | `type`: nominal→temporal; completely restructure — bar chart of 1000 daily bars is wrong; should suggest aggregation (monthly) or chart type change (line) | The chart type itself is wrong for this cardinality — no VL parameter tweak saves it |

**Swapping both axes (simultaneous re-encoding):**

| Change | What must change | Why it's especially hard |
|--------|-----------------|------------------------|
| **X: Product→Year, Y: Revenue→Rank** (bar → bump chart) | Mark: bar→line+circle (layered); X `type`: nominal→temporal or ordinal; Y `type`: quantitative→quantitative with `reverse: true`; `zero: false`; domain padding; add `color` encoding for Product; `width`/`height` both change; sort removed | Two axes change simultaneously — the entire chart structure transforms. A bar chart becomes a bump chart, requiring layered marks, reversed scale, and a color channel. No single-parameter edit path exists. |
| **X: Product→Date, Y: Revenue→Temperature** (bar → line chart) | Mark: bar→line; X `type`: nominal→temporal; Y `scale.zero`: true→false; remove bar sort; add temporal formatting; `width` depends on date range; remove step-based sizing | Both axes change semantic type. The bar's step-based sizing is wrong for a continuous temporal axis. The Y zero behavior flips. The mark type should change because bars on a dense temporal axis are unreadable. |
| **X: Product→Product, Y: Revenue→Revenue, +color: Region** (bar → grouped bar) | Mark config: add `xOffset` encoding; `width` must grow (5 sub-bars per group = 5× wider steps); step size changes; legend appears; color scale needed | Adding a single encoding field (color) restructures the entire layout. VL's grouped bar requires `xOffset`, which changes step semantics — the step now controls the group, not individual bars. |
| **X: Product→Region, Y: Revenue→Count(*)** (many bars → few bars, aggregated) | `width`: shrink dramatically; remove label angle; add aggregate: "count" on Y; encoding semantics change from raw value to computed aggregate | Cardinality drops from 80 to 5, so the sizing is wildly wrong. Plus the Y encoding changes from a data field to a computed aggregate — different VL syntax entirely. |

That's **5–10 parameter changes** per field swap, and the right changes
depend on the semantic type, the data range, and the cardinality of the
new field. When both axes change at once, the parameter interactions
multiply — the correct encoding type for X affects the valid mark type,
which affects the valid scale type for Y, which affects sizing. Every
combination is different.

**From a UI (e.g., Data Formulator's drag-and-drop):** The UI can swap
the field name easily, but it cannot know which of those 5–8 parameters
to update. Should `zero` change? Should the scale reverse? Should the
encoding type switch from quantitative to ordinal? A generic UI has no
way to infer these — they depend on what the data *means*, not just its
data type. So the user drags "Rank" to Y and gets a chart with rank
values on a zero-based unreversed quantitative scale — technically
rendered but visually wrong. They then have to either:

- Manually find and fix each parameter through the UI (if exposed at all),
  hoping they know the right combination, or
- Ask the LLM to regenerate the whole spec.

**From code:** Editing the VL JSON directly is even harder. The user must
understand VL's scale, axis, and encoding APIs well enough to know that
Rank needs `type: "ordinal"`, `scale.reverse: true`, `scale.domain` with
padding, and `nice: false` to prevent VL from rounding the domain back to
include 0. Most users — and most LLMs — miss at least one of these.

**The irony of good-looking LLM output:** When an LLM *does* produce a
polished chart, it achieves that quality precisely by hard-coding values
tuned to the current data: `"width": 800` (for 80 products),
`"axis": { "labelAngle": -45 }` (for long product names),
`"scale": { "domain": [0, 950000] }` (for this revenue range),
`"mark": { "size": 8 }` (for this point density). These hard-coded
constants make the chart look good *right now* — but they become
liabilities the moment anything changes:

| Hard-coded value | Breaks when… |
|------------------|-------------|
| `"width": 800` | User filters to 5 products (massive empty bars) or adds 200 (unreadable 4 px bars) |
| `"labelAngle": -45` | User swaps X to Region (3-letter labels that don't need rotation) |
| `"domain": [0, 950000]` | User swaps Y to Temperature (axis domain is now wrong by 6 orders of magnitude) |
| `"mark.size": 8` | User switches to scatter with 1000 points (dots overlap completely) |
| `"scale.zero": true` | User swaps Y to Rank (zero-based rank axis wastes space) |
| `"format": "$,.0f"` | User swaps Y to Percentage (values show as "$48" instead of "48%") |

The better the LLM's initial output, the *more* hard-coded constants it
contains, and the *harder* the chart is to edit. This creates a vicious
cycle: high-quality generation → brittle spec → forced LLM regeneration
on every edit → high cost and latency → poor exploration experience.

A simpler LLM-generated spec (fewer hard-coded values) would be easier
to edit, but it looks worse — VL's defaults are often wrong (e.g.,
`width: 400` for any cardinality, alphabetical sort for categories).
The user is trapped between *good but fragile* and *ugly but editable*.

**The combinatorial problem:** With $F$ fields and $C$ chart types, there
are $F \times C$ possible configurations, each potentially needing
different zero behavior, encoding type, scale direction, domain padding,
axis formatting, sizing, and sort order. For a dataset with 15 fields and
5 chart types, that's 75 configurations. Asking the LLM to handle each
one costs ~2–5 seconds and ~500–1000 tokens per call. Over a 30-minute
exploration session, this adds up to dozens of LLM calls — each one an
interruption to the user's analytical flow.

#### Why semantic types are the secret sauce

The root cause of all the problems above is a **missing abstraction**.
Vega-Lite knows the data *type* (number, string, date) but not the data
*meaning*. A number could be revenue, temperature, rank, or a zip code —
and the correct visualization parameters are completely different for each.
Without meaning, every parameter must be specified explicitly (by the LLM
or the user), and every field swap invalidates those explicit choices.

Semantic types fill exactly this gap. They are a thin layer of metadata —
one string per field (e.g., `"Revenue"`, `"Rank"`, `"Temperature"`,
`"Month"`) — that captures what the data *means*. From this single piece
of information, the compiler can deterministically derive everything else:

```
Semantic type
    ↓
    ├── Encoding type     (Revenue → quantitative, Rank → ordinal, Month → ordinal)
    ├── Zero baseline     (Revenue → true, Temperature → false, Rank → false)
    ├── Domain padding    (Rank → 8%, Temperature → 5%, Revenue → 0%)
    ├── Scale direction   (Rank → reversed, others → normal)
    ├── Axis formatting   (Revenue → "$,.0f", Percentage → ".0%", Year → "%Y")
    ├── Sort order        (Month → calendar order, Product → by value)
    └── Sizing model      (nominal → spring, quantitative → per-axis stretch)
```

This is why the approach works: **semantic types are stable across edits**.
When the user swaps Y from Revenue to Temperature, the *field* changes and
every parameter derivation is different — but the *process* is identical.
The compiler runs the same derivation pipeline with `"Temperature"` instead
of `"Revenue"` and gets the right answer every time. No hard-coded constant
becomes stale because there are no hard-coded constants.

The key insight is that semantic types are the *right level of abstraction*
for the LLM to communicate. They are:

- **Easy to generate.** Assigning a semantic type to a field is a
  classification task — one of the simplest things LLMs do. An LLM that
  struggles to write correct VL scale configurations can still reliably
  say "this column is Revenue" or "this column is Rank."

- **Stable across the session.** Once assigned, semantic types don't change
  when the user swaps fields or changes chart types. Revenue is still
  Revenue whether it's on a bar chart or a scatter plot, on the Y axis or
  the color channel.

- **Compositional.** Each field's semantic type contributes independently
  to the chart configuration. The compiler doesn't need to reason about
  field *combinations* — it derives parameters per-field and per-channel,
  then the sizing models (spring, per-axis stretch) compose the results.

This turns the $F \times C$ combinatorial problem into an $F + C$ problem:
the LLM classifies each field once ($F$ decisions), the user picks a chart
type ($C$ choices), and the compiler handles the cross-product. Instead of
75 unique configurations that each need an LLM call, the system needs 15
type assignments (done once) and handles all 75 configurations
deterministically.

**Agents-chart breaks the vicious cycle.** There are no hard-coded
constants to become stale — every parameter is derived at compile time
from semantic types + data characteristics. When the user swaps a field,
the compiler looks up its semantic type and re-derives all parameters
automatically. The chart always looks good because the sizing, zero
behavior, and formatting are computed fresh, not carried over from a
previous configuration. No LLM call, no manual parameter editing, no
broken charts.

#### Walkthrough

**Scenario:** An analyst starts with a Revenue bar chart, then wants to
explore: *"What if I look at Temperature instead? What about Rank?"*

<table>
<tr><th></th><th>Agents-Chart</th><th>Raw Vega-Lite</th></tr>
<tr>
<td><b>Initial chart</b></td>
<td>LLM generates spec + semantic types</td>
<td>LLM generates full VL spec</td>
</tr>
<tr>
<td><b>Swap Y to Temperature</b></td>
<td>

User drags Temperature to Y axis.
Compiler sees `Temperature` → zero-arbitrary
→ sets `zero: false`, pad = 5%.
**No LLM call.**

</td>
<td>

User must ask LLM: *"change Y to Temperature"*.
LLM must know to set `zero: false`,
adjust domain, update formatting.
**1 LLM call** (+ latency + cost).

</td>
</tr>
<tr>
<td><b>Change to scatter plot</b></td>
<td>

User clicks "Scatter Plot".
Compiler switches from spring model to
per-axis stretch, re-derives sizing.
**No LLM call.**

</td>
<td>

User must ask LLM: *"make it a scatter"*.
LLM must change mark, remove sort,
adjust width/height, update scales.
**1 LLM call.**

</td>
</tr>
<tr>
<td><b>Swap Y to Rank</b></td>
<td>

User drags Rank to Y.
Compiler sees `Rank` → ordinal, zero-arbitrary
→ `zero: false`, pad = 8%, reversed axis.
**No LLM call.**

</td>
<td>

User must ask LLM again.
LLM must know Rank is ordinal,
needs reversed scale, domain padding.
**1 LLM call.**

</td>
</tr>
<tr>
<td><b>Total LLM calls</b></td>
<td><b>1</b> (initial generation only)</td>
<td><b>4</b> (initial + every edit)</td>
</tr>
</table>

In a typical exploration session, a user might try 10–15 encoding
variations. With raw VL, that's 10–15 LLM round-trips. With agents-chart,
it's 1. The semantic types from the first generation carry the user through
the entire exploration.

### 3. Bespoke charts: complexity absorbed by the compiler

**Task:** Bump chart — 8 companies ranked over 12 months.

<table>
<tr><th>Agents-Chart input</th><th>Vega-Lite (what LLM must produce)</th></tr>
<tr>
<td>

```json
{
  "chartType": "Bump Chart",
  "encodings": {
    "x": { "field": "Month" },
    "y": { "field": "Rank" },
    "color": { "field": "Company" }
  },
  "semanticTypes": {
    "Month": "Month",
    "Rank": "Rank",
    "Company": "Company"
  }
}
```

</td>
<td>

```json
{
  "width": 400, "height": 320,
  "layer": [
    {
      "mark": { "type": "line",
        "strokeWidth": 2.5,
        "interpolate": "monotone" },
      "encoding": {
        "x": { "field": "Month",
          "type": "ordinal" },
        "y": { "field": "Rank",
          "type": "quantitative",
          "scale": { "reverse": true,
            "domain": [-0.5, 8.5],
            "zero": false, "nice": false },
          "axis": { "tickCount": 8,
            "grid": false } },
        "color": { "field": "Company",
          "type": "nominal" }
      }
    },
    {
      "mark": { "type": "circle",
        "size": 80 },
      "encoding": { "...same..." }
    }
  ]
}
```

</td>
</tr>
</table>

The VL spec for a bump chart requires **layered marks** (line + circle),
a **reversed Y scale** with explicit domain, **padding** so rank 1 isn't
crushed against the axis, and careful tick configuration. It's ~40 lines
of interdependent config that most LLMs get wrong on the first try — the
scale direction, the domain bounds, or the layer composition.

With agents-chart, the bump chart template handles all of this. The LLM
writes the same ~7 lines it would for any chart. The complexity lives in
the compiler, which has been tested and is deterministic.

Other bespoke charts with similar complexity savings:

| Chart type | VL complexity the compiler absorbs |
|------------|-----------------------------------|
| **Streamgraph** | Stack offset (`"center"`), area interpolation, series ordering |
| **Candlestick** | Layered rect + rule, open/close/high/low encoding, color by direction |
| **Waterfall** | Running sum transform, positive/negative coloring, connector rules |
| **Radar** | Polar coordinates via theta/radius, circular axis, layered grid lines |
| **Ridge plot** | Row-faceted density, overlapping layout, per-facet bandwidth |

### 4. Failure modes

**Scenario:** LLM assigns Revenue (quantitative) to a color channel expecting
a scatter plot, but also assigns it to Y — creating a redundant double-encoding.

| | Agents-Chart | Raw Vega-Lite |
|--|---|---|
| **What happens** | Compiler detects the redundancy via semantic metadata and can flag: *"Revenue is mapped to both Y and color — color adds no information"* | VL renders the chart silently. User sees a scatter plot with a gradient legend that duplicates the Y axis. No error, no explanation. |
| **Recovery** | Semantic explanation is actionable: user or agent can swap color to Company | User must notice the problem themselves and figure out why |

**Scenario:** 500 categories on a faceted × discrete chart (50 facets × 10
categories). Raw VL with default `width: 400` produces a 400 px chart with
50 squished facets, each containing 10 unreadable 0.8 px bars. The chart
technically renders but is useless.

With agents-chart, the spring model detects the overflow: each facet subplot
gets 60 px minimum, bars compress to 6 px (or truncate with a warning if
even that doesn't fit). The chart is still wide, but each bar remains
readable and the user gets a clear message about what was truncated.

