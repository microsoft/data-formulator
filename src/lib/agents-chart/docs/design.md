# Agents-Chart: Automatic Layout Design

> Design overview for the `agents-chart` assembler — a visualization library
> designed for AI agents that compiles high-level chart specifications into
> Vega-Lite. For full details see
> [design-stretch-model.md](design-stretch-model.md) and
> [design-semantic-types.md](design-semantic-types.md).

## TL;DR

LLMs generating raw Vega-Lite face a dilemma: simple specs are editable
but look bad (wrong sizing, misleading encodings); polished specs look
good but are brittle (hard-coded values break on every field swap).
**Agents-chart** resolves this by introducing a semantic layer between the
LLM and VL. The LLM outputs only chart type, field assignments, and a
**semantic type** per field (e.g., `Revenue`, `Rank`, `CategoryCode`).
From these, a deterministic compiler derives all low-level parameters —
axis sizing (spring model for discrete axes, pressure model for continuous),
zero-baseline behavior, formatting, color schemes, and bespoke mark
templates — so the chart looks good *and* stays editable without calling
the LLM again.

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
monetary value, or a serial number, or a group id. Today, the LLM must decide the VL
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

The main layout challenge is **coordinating sizing across axes, layers,
mark types, and facets** — parameters that are deeply interdependent
(e.g., facet count affects subplot width, which affects bar width, which
affects label rotation). We address this with a unified physics-inspired
model: a spring model for discrete axes and a pressure model for
continuous axes, both composable with facet and layer structures. This
replaces the alternative of asking the LLM to set 10–30 sizing parameters
per chart — which is costly (one call per edit) and visually inconsistent
across runs (the same prompt produces different widths, step sizes, and
label angles each time).

### The workflow

```
1. AI agent generates:  chart spec  +  semantic types for each field
                         (small JSON)    (e.g., Revenue, Year, Company)

2. User edits chart to explore new information:    swap field / change mark type / add facet (NO AI needed!)
   └─→ Compiler re-derives all config from semantic types
   └─→ Chart looks good automatically  (98% of edits)

3. (Optional) Fine-tune: user asks LLM to edit underlying Vega-Lite
                          for detailed style customization  (2% of edits)
```

The chart spec is intentionally minimal — in Data Formulator, it's a small
JSON object returned alongside the data transformation code, so that
precious tokens go where they matter most: data computation and
transformation, not visualization configuration.

### What this document covers

Two systems make this possible:

1. **Semantic type system** — a type hierarchy that encodes data meaning,
   driving encoding-type decisions, zero-baseline behavior, and domain
   configuration.
2. **Automatic axis sizing** — physics-based models that compute chart
   dimensions from data density, so the layout adapts to any data without
   manual sizing.

The rest of this document is organized as:

- **Side-by-side examples** — four progressively complex comparisons
  (simple bar, lollipop, faceted overflow, temporal heatmap) showing where
  agents-chart's abstractions pay off vs. raw Vega-Lite.
- **Three questions** — what happens with VL defaults? With LLM-tuned VL?
  And what does agents-chart bring?
- **System overview** — how the compiler pipeline composes semantic types
  with axis sizing to produce a final VL spec.
- **Design details** — the spring model (discrete axes), per-axis stretch
  model (continuous axes), and the semantic type hierarchy in full.

---

## Side-by-Side: Agents-Chart vs. Raw Vega-Lite

Four examples that progressively demonstrate where agents-chart's
abstractions pay off: templates for complex marks, dynamic layout for
overflow, and semantic types for data-dependent encoding.

In every case, *the agents-chart spec is the same shape*: chart type +
field assignments + semantic types (~7–12 lines). What changes is how
much VL config the compiler must derive — and that's where the gap grows.

### Example 1: Simple bar chart — similar complexity

**Task:** Bar chart of Revenue by 5 Regions.

**Agents-chart:** Chart type, two field encodings, two semantic types.

**Vega-Lite:** Mark type, two field encodings with explicit `type` annotations.

The two are nearly identical in length and complexity. VL's defaults happen
to work: 5 bars at the default step size (20 px) produce a ~100 px chart
that fits comfortably, `zero: true` is correct for bars, and alphabetical
sort is acceptable for a few regions. **No win here — and that's the
point.** The library isn't designed to help with cases VL already handles
well.

The advantages emerge as the chart gets more complex.

### Example 2: Lollipop chart — template + semantic types

**Task:** Lollipop chart of Revenue by Product (top 10), colored by Group
(values: 1, 2, 3, 4, 5 — categorical groups encoded as numbers).

**Agents-chart:** Chart type = "Lollipop Chart", three field encodings
(x, y, color), three semantic types (`Revenue`, `Product`,
`CategoryCode`). Same ~10 lines as any chart.

**Vega-Lite requires coordinating** all of the following:

| VL parameter | What and why |
|-------------|-------------|
| Layered spec structure | Must use `layer: [...]` — a lollipop is two marks, not one |
| Rule mark config | `mark.type: "rule"`, `strokeWidth`, `color` for the stem |
| Circle mark config | `mark.type: "circle"`, `size`, `color` for the dot |
| Duplicated encoding | Both layers need identical `x`, `y`, and `color` encodings — mismatch breaks alignment or coloring |
| Sort | `sort: "-x"` on the Y axis to rank products by value |
| Zero baseline | `scale.zero: true` on the X axis (Revenue is zero-meaningful) |
| Step size | VL default step (20 px) works here for 10 items, but would need explicit `width` or `step` override if the list were longer. The spec is implicitly fragile — looks fine at 10 products, breaks if the data grows. |
| Axis formatting | `axis.format: "~s"` for compact numbers |
| Color encoding type | Group values are `1, 2, 3, 4, 5` — VL defaults to `quantitative`, producing a continuous blue gradient. Must manually set `"type": "nominal"` to get a categorical color scheme with distinct hues per group. |
| Color scale scheme | With quantitative default, VL uses `"blues"` (sequential). Must override to a categorical palette (e.g., `"category10"`) — but only after fixing the type. |

The color problem is especially insidious: VL sees numbers and defaults to
`quantitative` with a sequential color scheme. Groups 1 and 2 get nearly
identical shades of blue — visually indistinguishable. The chart *renders*
without error but the color encoding is meaningless. With agents-chart,
`CategoryCode` → nominal → categorical palette, and groups get distinct
hues automatically.

Other bespoke charts with similar complexity savings:

| Chart type | VL complexity the template absorbs |
|------------|-----------------------------------|
| **Bump chart** | Layered line + circle, reversed Y, ordinal domain with padding |
| **Streamgraph** | Stack offset (`"center"`), area interpolation, series ordering |
| **Candlestick** | Layered rect + rule, open/close/high/low encoding, color by direction |
| **Waterfall** | Running sum transform, positive/negative coloring, connector rules |
| **Ridge plot** | Row-faceted density, overlapping layout, per-facet bandwidth |

### Example 3: Faceted bar chart — dynamic layout handles overflow

**Task:** Revenue by Product (80 products), faceted by Region (4 regions).

**Agents-chart:** Chart type, three field encodings (x, y, column), three
semantic types. Same ~12 lines.

**Vega-Lite must solve three coordinated sizing problems:**

| Problem | What VL requires | Why it's hard |
|---------|-----------------|---------------|
| **Canvas size** | Hard-code `width` per subplot + `columns` for facet wrap | VL's default step size (20 px) × 80 products = 1600 px per subplot → 4 facets = 6400 px total. Wildly overflows. Must override with explicit `width: 380` and `columns: 2`, but these numbers depend on each other. |
| **Step / bar width** | Hard-code `step` or `width` to override VL's 20 px default | With `width: 380` for 80 bars, each bar is ~4.75 px — unreadable. Must also add `labelAngle: -90`, `labelLimit: 60`, `labelFontSize: 9`. If you use explicit `step` instead, you're back to choosing a step size that works for this cardinality but breaks for others. |
| **Facet wrapping** | Hard-code `columns` | 4 columns → each subplot is 190 px (bars unreadable). 1 column → page is 4× taller. 2 columns fits but per-subplot width must coordinate with total. |
| **Scale resolution** | `resolve.scale.x: "independent"` | Each facet may have different products — shared scale wastes space on absent categories. |

These decisions are **interdependent**: the number of facet columns
determines the available width per subplot, which determines the bar width,
which determines whether labels fit, which determines if label rotation and
truncation are needed. VL provides no mechanism to coordinate them — each
is a separate hard-coded parameter.

With agents-chart, the spring model handles all three automatically:
- The facet stretch factor ($\beta_f$) determines the overall canvas growth.
- Each subplot runs its own spring model: 80 products × $\ell_0 = 20$ px
  overflows → items compress to $\ell = 8$ px, subplot stretches to fit.
- Label rotation and truncation are derived from the count and string
  lengths.
- The result: each bar is readable (8 px, not 2 px), the total width is
  controlled (not 6400 px), and facet columns are chosen to balance
  readability with compactness. No manual coordination needed.

### Example 4: Heatmap with temporal × category — semantic types drive encoding

**Task:** Heatmap of event counts — UTC timestamps (hourly, 30 days) on X,
Category (15 event types) on Y, count as color.

**Agents-chart:** Chart type = "Heatmap", three encodings (x, y, color),
three semantic types (`DateTime`, `Category`, `Count`). ~12 lines.

**Vega-Lite requires 10+ manual decisions**, all stemming from needing to
know what the data *means*:

| Decision | What VL requires | What agents-chart derives |
|----------|-----------------|--------------------------|
| X encoding type | `"type": "temporal"` — must recognize timestamp is a date, not a number | `DateTime` → temporal |
| Time formatting | `"format": "%m/%d %H:%M"` — must pick format for hourly granularity | `DateTime` + hourly range → appropriate format |
| UTC scale | `"scale": { "type": "utc" }` — must know timestamps are UTC | `DateTime` → UTC handling |
| Time unit | `"timeUnit": "yearmonthdatehoursminutes"` — verbose, error-prone | Derived from data range + granularity |
| Label rotation | `"labelAngle": -45` — must guess from label width | Auto from label count + string length |
| Y encoding type | `"type": "nominal"` — must decide Category isn't quantitative | `Category` → nominal |
| Color zero baseline | `"scale.zero": true` — Count should start from 0 | `Count` → zero-meaningful → `zero: true` |
| Color scheme | `"scheme": "blues"` — sequential scheme for counts | `Count` → quantitative sequential → blues |
| Color format | `"format": "d"` — integer formatting for counts | `Count` → integer → `"d"` |
| Cell step size | VL default step (20 px) → 720 × 20 = 14,400 px wide. Must override to smaller step or hard-code `width`. | Heatmap spring model: 720 cells × $\ell_0$ = 8 px per cell → elastic equilibrium at ~800 px |
| Canvas width | Hard-code `"width": 800` after manually computing 720 cells | Spring model derives width automatically from cell count + step compression |

That's **11 manual decisions** in VL, all of which agents-chart derives
automatically from three semantic type annotations.

If the timestamp column contained Unix epoch numbers (e.g., `1739600400`),
VL would default to `quantitative` — showing a continuous axis from 0 to
1.7 billion. The semantic type `DateTime` tells the compiler to treat it as
temporal regardless of the raw data format.

---

## Three Questions

### Q1: What if we just use Vega-Lite's defaults?

**A: The chart spec is simple and editable, but it looks bad — and bespoke
charts are impossible.**

VL defaults produce a minimal spec: just field names, mark type, and data.
That's great for editability — swap a field name and the chart re-renders.
But the *quality* of what renders is poor, because VL's defaults are
generic heuristics that ignore both data characteristics and semantic
meaning.

**Sizing failures** — the chart is the wrong size for the data:

| Scenario | VL default | What's wrong |
|----------|-----------|-------------|
| **Bar chart, 80 products** | `step: 20` → 1600 px wide | Overflows any container. Forces horizontal scrolling; unusable without a giant monitor. |
| **Grouped bar, 30 × 5** | 30 × 5 × 20 = 3000 px | Grouped bars multiply the problem: each product group has 5 sub-bars at 20 px each. |
| **Bars on temporal X (daily)** | VL doesn't auto-band temporal | Bars overlap or collapse to 1 px. Temporal axes are continuous; VL has no step-based sizing for them. |
| **Line chart, 15 series** | Fixed `height: 300` | 15 lines in 300 px → ~20 px per series. Unreadable spaghetti. |
| **Scatter, 2000 points** | Fixed 400 × 300 | Total mark area (156K px²) exceeds canvas area (120K px²). A solid blob. |
| **80 product labels** | No auto-rotation | Labels overlap into an unreadable smear. |

**Composition makes it worse** — facets and `xOffset` multiply the
single-view problems above:

These are not separate issues — they compound *on top of* the basic layout
failures. Every single-view sizing problem gets multiplied by the number of
facets, and `xOffset` (grouped bars) adds another multiplicative factor
within each subplot.

| Scenario | VL default | What's wrong |
|----------|-----------|-------------|
| **80 products, 4 facets** | 4 × 1600 px subplots | 6400 px total — comparison between facets is impossible because they're screens apart. The single-view overflow (1600 px) is already bad; faceting quadruples it. |
| **Grouped bar, 30 × 5, faceted × 4** | Facet × xOffset × step all multiply | 4 facets × 30 products × 5 groups × 20 px = 12,000 px. Facets and `xOffset` are independent VL mechanisms with no coordination — each blindly applies its own step/spacing, and there's no way to express "fit everything within 800 px." |
| **Facet columns + subplot width** | Must hard-code both `columns` and `width` | These are interdependent: 4 columns → each subplot is 190 px (bars unreadable). 2 columns → wider subplots but taller page. The right choice depends on bar count, label length, and container size — VL has no coordination mechanism. |

**Semantic failures** — the chart misrepresents the data:

The same number can mean completely different things, and VL defaults
can't tell the difference.

`17329487239` could be a **Unix timestamp**, a **Customer ID**, **Revenue
($)**, or a **sensor reading** — each requiring different encoding type
(temporal / nominal / quantitative), different zero behavior, different
formatting, different color scheme. VL sees a number and defaults to
`quantitative`. If it's a customer ID, you get a continuous axis from 0
to 17 billion with a single dot. If it's a timestamp, you get raw numbers
instead of dates.

`1, 2, 3, 4, 5` could be **Rank**, **Star rating**, **Quantity**,
**Category code** (1=North, 2=South…), or a **Likert score** — each
needing different zero behavior, scale direction, tick formatting, and
chart compatibility. VL treats all as `quantitative, zero: true,
ascending`. For Rank, this means rank 1 (best) at the bottom, zero
wasted, ticks at "2.5" — absurd. For category codes, you get a
continuous axis with interpolated ticks between codes that don't exist.

Simple heuristics don't fix this: Rank, Rating, Quantity, Category code,
and Likert are all integers with identical cardinality. Neither integer
detection nor cardinality checking distinguishes them. The only way to
know the correct encoding is to know what the data *means*.

**Bespoke charts are out of reach.** VL defaults don't produce bump
charts, candlestick charts, streamgraphs, waterfall charts, or radar
plots. These require specific mark layering, custom transforms, precise
scale configurations, and specialized encodings. A default approach can
only produce basic bar / line / scatter / area charts.

**Bottom line:** VL defaults give you editability and simplicity, but
the charts are wrong-sized, semantically misleading, and limited to
basic mark types.

### Q2: What if we ask the LLM to generate a good-looking chart?

**A: The chart looks great, but the spec is brittle and nearly impossible
to edit.**

When a good LLM invests tokens to produce a polished chart, it achieves
quality precisely by **hard-coding values tuned to the current data**:

| Hard-coded value | Breaks when… |
|------------------|-------------|
| `"width": 800` | User filters to 5 products (massive empty bars) or adds 200 (unreadable) |
| `"labelAngle": -45` | User swaps X to Region (3-letter labels don't need rotation) |
| `"domain": [0, 950000]` | User swaps Y to Temperature (wrong by 6 orders of magnitude) |
| `"mark.size": 8` | User switches to scatter with 1000 points (dots overlap completely) |
| `"scale.zero": true` | User swaps Y to Rank (zero-based rank wastes space, reads inverted) |
| `"format": "$,.0f"` | User swaps Y to Percentage (shows "$48" instead of "48%") |

The better the LLM's output, the *more* hard-coded constants it contains,
and the *harder* the chart is to edit. This creates a vicious cycle:
**high-quality generation → brittle spec → forced regeneration on every
edit → high cost and latency → poor exploration experience.**

**The parameters live at different levels and must coordinate.** A polished
VL spec scatters its configuration across multiple layers that all couple
to each other:

| Level | Examples | Coordinates with |
|-------|---------|-----------------|
| **Global** | `width`, `height`, `autosize`, `padding` | Step size, facet columns, mark size |
| **Per-axis** | `scale.zero`, `scale.domain`, `scale.type`, `axis.format`, `axis.labelAngle` | Global width (label overflow), mark type (zero behavior), encoding type |
| **Per-mark** | `mark.size`, `mark.strokeWidth`, `mark.opacity` | Global dimensions (overlap), data cardinality |
| **Composition** | `facet.columns`, `resolve.scale`, `xOffset.step` | Global width (subplot size), per-axis step (bar width), label config |

Editing any one parameter without adjusting the others produces a
broken chart. Change `width` from 800 to 400? The label angle, step
size, and font size were tuned for 800 — now labels overlap. Add a
facet column? The per-subplot width halves, so bars become unreadable
unless you also shrink the step, rotate labels, and adjust font size.
Switch from bar to scatter? `scale.zero`, `mark.size`, and `domain`
all need updating, but `width` and `labelAngle` might also change
because scatter points have different spatial needs than bars.

This coordination is **complex and arbitrary enough that it can't be
made editable without calling the LLM.** There's no simple rule like
"halve width → halve step" — the correct adjustment depends on the data
(cardinality, label lengths, value ranges), the mark type, the encoding
types, and the composition structure, all simultaneously. A human editing
by hand would need to understand VL's scale, axis, and layout APIs at
expert level. A rule-based system would need to enumerate the full
cross-product of parameter interactions. Neither is practical — which is
why every edit becomes an LLM call.

**Structural rewrites are the worst case.** When *both* axes change
simultaneously, the parameter interactions multiply. Swapping Product→Year
and Revenue→Rank transforms a bar chart into a bump chart: the mark
changes from bar to line+circle (layered), X type changes from nominal to
ordinal, Y gets reversed with `zero: false` and domain padding, a color
channel appears, and width/height both change. No single-parameter edit
path exists — it's a complete structural rewrite that touches every level
of the spec simultaneously.

**The alternative: call the LLM for every edit.** This works, but:

- **Expensive.** ~500–1000 tokens per call × 10–15 edits in a session =
  significant cost. Each call takes 2–5 seconds — an interruption to
  analytical flow.
- **Requires a strong model.** Basic bar/line/scatter might work with a
  weaker model, but bespoke charts (bump, candlestick, waterfall) need
  layered marks, internal data transforms, and complex scale
  configurations. Only frontier models handle these reliably, and even
  they struggle with the correct combination of reversed scale + domain
  padding + tick count + layer composition.
- **The $F \times C$ combinatorial problem.** With 15 fields and 5 chart
  types, there are 75 possible configurations. Asking the LLM to handle
  each one individually costs dozens of calls per exploration session.

**Bottom line:** LLM-generated charts look good once, but the spec is
too complex to edit by hand, and regeneration per edit is slow, expensive,
and requires strong models — especially for non-basic chart types.

### Q3: What does agents-chart bring?

**A: Both. Good-looking *and* editable — by operating at a higher semantic
level above Vega-Lite.**

Agents-chart is a **semantic-level visualization language** that compiles
down to Vega-Lite. The LLM generates a minimal spec — chart type, field
assignments, and semantic types — and the compiler deterministically
derives all the low-level parameters (sizing, zero baseline, scale
direction, formatting, sort, color scheme) from semantic types + data
characteristics. The result:

| Property | VL defaults (Q1) | LLM-tuned VL (Q2) | Agents-chart |
|----------|------------------|--------------------|-------------|
| **Looks good** | ✗ | ✓ | ✓ |
| **Editable** | ✓ (simple spec) | ✗ (brittle, hard-coded) | ✓ (semantic spec) |
| **Bespoke charts** | ✗ | Sometimes (strong model) | ✓ (templates) |
| **Cost per edit** | 0 (no LLM) | 1 LLM call ($, latency) | 0 (no LLM) |
| **Generation difficulty** | Low (just fields + mark) | High (must coordinate 10–30 parameters across 4 levels) | Low (fields + semantic types) |
| **Model requirement** | N/A | Frontier for bespoke | Any (classification only) |

**How it works:**

The LLM's only job is **semantic classification** — assigning a type like
`"Revenue"`, `"Rank"`, `"Temperature"`, or `"Month"` to each data field.
This is one of the simplest tasks LLMs do (classify a column by its meaning).
From this single annotation per field, the compiler derives everything:

```
Semantic type
    ↓
    ├── Encoding type     (Revenue → quantitative, Rank → ordinal, Month → ordinal)
    ├── Zero baseline     (Revenue → true, Temperature → false, Rank → false)
    ├── Domain padding    (Rank → 8%, Temperature → 5%, Revenue → 0%)
    ├── Scale direction   (Rank → reversed, others → normal)
    ├── Axis formatting   (Revenue → "$,.0f", Percentage → ".0%", Year → "%Y")
    ├── Sort order        (Month → calendar order, Product → by value)
    ├── Color scheme      (Company → categorical, Revenue → sequential)
    └── Sizing model      (nominal → spring, quantitative → per-axis stretch)
```

**Semantic types are stable across edits.** When the user swaps Y from
Revenue to Temperature, the compiler re-derives all parameters from
`"Temperature"` instead of `"Revenue"` and gets the right answer — no
hard-coded constant becomes stale because there are no hard-coded
constants. The chart always looks good because sizing, zero behavior, and
formatting are computed fresh from the semantic types at compile time.

**The $F \times C$ problem becomes $F + C$.** The LLM classifies each
field once ($F$ decisions), the user picks a chart type ($C$ choices),
and the compiler handles the cross-product. Instead of 75 configurations
that each need an LLM call, the system needs 15 type assignments (done
once) and handles all 75 deterministically.

**Bespoke charts become as easy as basic charts.** Agents-chart's
template system means bump charts, candlestick charts, streamgraphs,
waterfall charts, and ridge plots all take the same ~7-line spec as a
bar chart. The complexity (layered marks, custom transforms, reversed
scales, specialized encodings) lives in the compiler, which is tested
and deterministic. This expands expressive power without raising the
spec complexity — the LLM doesn't need to understand layered VL marks
or polar coordinates.

**The VL output is still there for the 2% case.** Agents-chart compiles
to standard Vega-Lite. If a user needs to fine-tune a very specific
visual detail (custom annotation placement, unusual color breakpoints,
bespoke interaction), they can edit the generated VL directly. Nothing
is lost — the compiler handles the 98% of decisions that are derivable
from semantics, and the user can override the remaining 2% in VL.

**One spec, many targets.** Because agents-chart operates at a semantic
level above any particular charting library, the same spec can in
principle compile to different backends — Vega-Lite today, but also
ECharts, Plotly, Observable Plot, or D3 templates tomorrow. The LLM
generates one semantic description (chart type + field assignments +
semantic types), and the compiler dispatches to whichever rendering
ecosystem fits the deployment context. Build the semantic system once,
target any chart library.

### Failure modes

Directly generating Vega-Lite means failures are either **catastrophic**
(the chart crashes or renders at absurd dimensions like 2000 px × 80 px —
the user sees nothing useful) or **silent** (the chart renders without
error but misrepresents the data — arguably worse, because the user trusts
a misleading visualization). VL provides only low-level errors
(`"Invalid specification"`) that don't explain *why* the design is wrong
for the given data.

Because agents-chart operates at the semantic level, it includes a
**semantic constraint system** that validates chart configurations *before*
compilation and produces actionable, human-readable explanations when
something is wrong. Failed charts fail elegantly — with a reason, not a
crash.

**Semantic validation — catching violations before rendering:**

| Violation | What agents-chart detects | What raw VL does |
|-----------|--------------------------|-----------------|
| **Chart–data incompatibility** | Pyramid chart requires exactly 2 categories and non-negative values. If the field has 5 categories or contains negative values (not counts), the compiler rejects with: *"Pyramid chart requires exactly 2 categories; 'Region' has 5"* or *"Pyramid chart requires non-negative values; 'Profit' contains negative values"* | VL renders a broken or nonsensical layered bar chart. No error. |
| **Redundant encoding** | Revenue mapped to both Y and color → *"Revenue is mapped to both Y and color — color adds no information"* | Renders silently with a gradient legend that duplicates the Y axis. User may not notice. |
| **Field–channel mismatch** | Nominal field on a quantitative-only channel, or too many categories for a color palette → *"Product has 80 values — too many for a color encoding"*. Numeric categorical values (e.g., Group codes 1–5) on color → *"Group is a CategoryCode — use nominal, not quantitative"* (see [Example 2](design.md#example-2-lollipop-chart--template--semantic-types)) | Renders 80 nearly-indistinguishable colors, or maps numeric categories to a continuous gradient where groups 1 and 2 get identical shades. No warning either way. |
| **Missing required encoding** | Candlestick without high/low fields → *"Candlestick chart requires Open, High, Low, Close fields"* | Crashes or renders partial marks with no explanation. |

**Overflow detection — explaining *why* the chart was clipped:**

| Scenario | Agents-chart response | Raw VL result |
|----------|----------------------|---------------|
| **80 products × 4 facets** | Spring model detects overflow. Report: *"X axis clipped: 80 products compressed from 20 px to 8 px per bar; canvas stretched from 400 px to 800 px (max). Consider filtering to top 20."* | 6400 px wide chart with horizontal scrolling, or a 400 px chart with 5 px bars — no explanation of why. |
| **720 temporal cells on heatmap** | *"Heatmap X axis: 720 hourly cells compressed to 1.1 px each. Consider aggregating to daily (30 cells) for readability."* | 14,400 px wide, or hard-coded to 400 px with 0.5 px cells — a solid color band. |
| **50 facets × 10 categories** | *"Facet overflow: 50 subplots cannot fit readable bars. Showing top 12 facets; 38 truncated."* — with each subplot still containing readable 6 px bars. | 400 px chart with 50 squished facets, each containing 10 unreadable 0.8 px bars. Technically renders but useless. |

The key difference: **agents-chart failures are diagnostic and recoverable**
— the message tells the user (or agent) what's wrong, why it's wrong, and
what to do about it. Raw VL failures are either invisible (silent
misrepresentation) or opaque (a crashed render or a 2000 px × 80 px
rectangle with no explanation).

---

## System Overview

The compiler pipeline composes semantic types with axis sizing:

```
Data fields
  │
  ├─── Semantic type inference
  │       → VisCategory → VL encoding type
  │       → ZeroDecision → scale.zero + domain padding
  │
  ├─── Axis classification
  │       → Banded (discrete)?  → Spring model (§1): stretch + resize bands
  │       → Non-banded?         → Pressure model (§2): stretch continuous axis
  │
  └─── Final VL spec
          width/height, step sizes, scale domains
```

**Example: Multi-series line chart (5 companies × 100 months of Revenue)**

1. **Semantic types.** Revenue → quantitative, zero-meaningful → `zero: true`.
   Month → temporal.
2. **Axis classification.** X = temporal non-banded, Y = quantitative
   non-banded → both use per-axis stretch.
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
2. **Axis classification.** X = nominal → banded → spring model.
3. **Spring model.** $N = 80$, $\ell_0 = 20$, $L_0 = 400$.
   Ideal = 1600 > 400 → Regime 3.
   With $\kappa = 1.0$: $\ell = (20 + 5) / 2 = 12.5$ px → $L = 1000$ px.
   Clamped at $L_{\max} = 800$ → $\ell = 10$ px.
4. **Final size.** 800 px wide, 320 px tall. Each bar gets 10 px — compressed
   but readable.

---

## Design Details

### §1  Discrete Axis Sizing: Spring Model

**Applies to:** bar, histogram, heatmap, boxplot, grouped bar — any axis
with banded items (one slot per category/bin).

#### Core idea

Model the axis as a box containing $N$ springs. Each spring (item) wants its
natural length $\ell_0$ (the ideal step size, ~20 px). The box (axis) resists
growing beyond its rest length $L_0$ (the canvas size). When $N \cdot \ell_0 > L_0$,
the system finds an equilibrium:

$$\ell = \frac{\kappa \cdot \ell_0 + L_0 / N}{1 + \kappa}$$

where $\kappa = k_{\text{item}} / k_{\text{wall}}$ controls how the
compression is split between shrinking items and stretching the axis.

#### Three regimes

| Regime | Condition | Behavior |
|--------|-----------|----------|
| **Fits** | $N \cdot \ell_0 \leq L_0$ | No action; items at natural size |
| **Elastic** | Items overflow but can be accommodated | Items compress + axis stretches to equilibrium |
| **Overflow** | $N \cdot \ell_{\min} > L_{\max}$ | Items at minimum size, axis at max; excess items truncated |

#### Key parameters

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

#### Extensions

- **Grouped bars**: the group (not the sub-bar) is the spring unit;
  $\ell_0 = m \cdot 20$ for $m$ sub-bars.
- **Faceted charts**: a second stretch factor $\beta_f$ governs the overall
  canvas; each subplot then runs its own spring model internally.

---

### §2  Continuous Axis Sizing: Per-Axis Stretch

**Applies to:** scatter, line, area, streamgraph, bump chart — any axis
where marks float at data-determined positions rather than occupying fixed bands.

#### Core idea

Springs don't apply because continuous marks don't own slots — 10 points
and 1000 points can both exist in the same canvas. The problem is **density**,
not allocation.

Each axis is stretched independently based on 1D crowding pressure:

$$s = \min\!\big(1 + \beta_c,\; p^{\,\alpha_c}\big)$$

where $p$ is the pressure ratio (how much mark cross-section competes for
pixels along that axis) and $\alpha_c$ is an elasticity exponent.

#### Two pressure modes

| Mode | Pressure formula | When used |
|------|------------------|-----------|
| **Positional** | $p = \text{uniquePixelPositions} \cdot \sqrt{\sigma} \;/\; \text{dim}_0$ | Default for both axes |
| **Series-count** | $p = n_{\text{series}} \cdot \sigma \;/\; \text{dim}_0$ | Line/area Y axis — series overlap is the dominant crowding signal |

**Why two modes?** On a line chart, Y-axis crowding comes from overlapping
series (5 lines piled up), not from the number of unique Y values. Positional
counting would miss correlated series that map to the same Y pixels.
Series-count captures the right signal: "how many lines compete for this
vertical space?"

#### Per-chart-type cross-sections

| Chart | $\sigma_x$ | $\sigma_y$ | Series axis |
|-------|-----------|-----------|-------------|
| Scatter | 30 | 30 | — |
| Line / Area | 100 | 20 | Y (auto) |
| Bump | 80 | 20 | Y (auto) |
| Stacked bar | 20 | 20 | Y (auto) |

The asymmetric cross-sections reflect real visual needs: on a line chart,
each date tick needs ~10 px of X space ($\sqrt{100}$), while each series
needs ~20 px of Y separation.

#### Positional ≥ Series constraint

For multi-series line/area charts, stretching the positional axis (X)
also reduces visual overlap between series. So the positional axis stretches
at least as much as the series axis:

$$s_x = \max(s_x^{\text{positional}},\; s_y^{\text{series}})$$

#### Why different marks → different sizes

Switching a line chart to a scatter plot changes the stretch because the
marks have genuinely different spatial needs. Lines are 1D marks that share
structure (all series share the same X positions); scatter points are 2D
marks that need individual separation. The size change reflects a real
difference in readability requirements — not a bug.

---

### §3  Semantic Types

**Problem:** Vega-Lite decides encoding type and zero-baseline from the mark,
not the data. A scatter plot of Revenue defaults to `zero: false`, truncating
bars of meaning. A bar chart of Temperature defaults to `zero: true`, wasting
space for a metric with no meaningful zero.

#### Type hierarchy

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

#### Zero-baseline decision

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

#### Domain padding

When `zero: false`, edge values sit on the axis frame. A small per-type
padding fraction pushes the domain out:

| Type | Pad | Effect |
|------|-----|--------|
| Rank, Index | 0.08 | Rank 1 gets breathing room; no misleading "0" tick |
| Score, Rating | 0.05 | Room for edge labels |
| Year | 0.03 | Tight framing, years are dense |
| Lat / Lon | 0.02 | Maps need minimal padding |
| Default | 0.05 | Safe general-purpose |