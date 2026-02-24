# Agents-Chart: A Visualization Library for Agent Developers

> You're building an AI agent that creates charts. Every approach you've
> tried is brittle — prompt-engineered Vega-Lite that breaks when users
> edit fields, sizing heuristics that fail on new data shapes, retry
> loops that burn tokens. **Agents-chart** is a library that eliminates
> this brittleness. For the system architecture, see
> [design_v3.md](design_v3.md).

---

## TL;DR

If you're building an AI agent that creates visualizations, you face a
fundamental problem. You can have your agent generate simple chart specs
that users can edit — but they look bad (wrong sizing, misleading
encodings). Or you can have it generate polished specs — but they're
brittle (hard-coded values break on every field swap, and every edit
requires another LLM call).

**Agents-chart** is a library that lets your agent sidestep this entirely.
Instead of generating low-level charting code, your agent outputs a
minimal semantic description: chart type, field assignments, and a
**semantic type** per field (e.g., `Revenue`, `Rank`, `CategoryCode`).
Agents-chart's compiler deterministically derives all low-level
parameters — axis sizing, zero-baseline behavior, formatting, color
schemes, bespoke mark templates — producing charts that look good *and*
stay editable without calling your agent again.

Because the semantic layer is **library-agnostic**, the same spec compiles
to multiple rendering backends — Vega-Lite, ECharts, and Chart.js today,
with Plotly or D3 tomorrow — without re-deriving any design rules. The
expensive work (semantic reasoning, layout computation) is done once;
only the final instantiation step differs per backend.

---

## The Problem: Building a Visualization Agent Is Brittle

### What you deal with today

You're building an agent that needs to create charts. Maybe it's a data
analysis copilot, a dashboard generator, or an automated reporting
pipeline. At some point your agent has to produce a visualization — and
that's where the brittleness starts.

The typical approach: your agent generates Vega-Lite (or ECharts options,
or Plotly traces) directly. You write prompt templates with examples,
add post-processing logic for edge cases, build retry loops for malformed
output. It works for your demo. Then real users arrive with real data,
and the charts break in ways you didn't anticipate.

Here is what goes wrong:

1. **Inconsistency across runs.** Your agent produces variable output
   quality — incorrect encodings, broken layouts, poor aesthetic defaults.
   You tune prompts for one chart type and break another. Weaker models
   (the ones you want to use for cost) struggle with anything beyond basic
   charts; even frontier models fail on composition, faceting, and layered
   designs.

2. **The quality–editability trap.** If your agent generates simple code,
   users can edit it (swap a field, change chart type) — but the chart
   looks mediocre. If your agent generates polished code, the chart looks
   great — but every user edit breaks it, forcing another round-trip to
   your agent. You can't have both, and neither option makes users happy.

3. **Expensive and slow for what it does.** Only frontier models reliably
   produce correct specs for non-trivial charts, because the parameter
   space (axis types, domain settings, sizing, formatting, mark config) is
   large and inter-dependent. Your agent is spending its most expensive
   tokens on visualization plumbing instead of the data computation that
   actually matters.

4. **Ugly failure modes that you can't catch.** When your agent's output
   breaks, the chart doesn't degrade gracefully — it produces extreme
   dimensions (10,000 px wide from high-cardinality facets), crashes the
   renderer, or silently misrepresents the data. The charting library
   gives only low-level errors that neither you, your users, nor your
   agent can act on.

### The brittleness cascade

Every fix you apply to your agent's visualization pipeline creates new
problems:

| What you try | What breaks next |
|-------------|------------------|
| Add sizing logic to prompts | Hard-coded for this data shape; breaks on different cardinality |
| Add more VL examples to prompts | Token count balloons; model cost rises; unrelated examples confuse the model |
| Post-process the output (fix widths, rotate labels) | You're now maintaining VL manipulation code that couples to every chart type |
| Validate output and retry on failure | More LLM calls, more latency, more cost; retry loops don't fix *semantic* errors (wrong encoding type) |
| Constrain output with JSON schema | Schema can enforce structure but not *correctness* — `{"type": "quantitative"}` is valid JSON for a CategoryCode field but produces a meaningless chart |
| Support a second charting library (e.g., ECharts for interactivity) | All your prompt templates, post-processing, and validation must be duplicated for the new API |

This is the **agent developer's treadmill**: you keep patching
visualization edge cases instead of building the data analysis features
that differentiate your product.

### What agents-chart gives you

Agents-chart is a library designed for your situation. It provides:

- **A simple output contract for your agent.** Your agent outputs a small
  JSON: chart type, field assignments, and a semantic type per field. No
  axis config, no sizing, no formatting, no mark layering. This is easy
  for any model to produce reliably — even cheap, fast models.

- **Automatic quality.** The library compiles that JSON into a polished
  chart with correct sizing, formatting, zero-baseline behavior, color
  schemes, and label handling. Your agent doesn't need to know Vega-Lite
  (or ECharts, or Chart.js) at all.

- **User edits without calling your agent.** Users can swap fields, change
  chart types, add facets — and the chart re-derives all low-level config
  automatically. **90% of edits need zero LLM calls.** Your agent is only
  invoked for the initial chart creation and for data transformations.

- **Bespoke charts at no extra prompt cost.** Grouped bars, bump charts,
  streamgraphs, candlesticks, ridge plots — they all take the same ~7-line
  spec as a basic bar chart. The mark layering, custom transforms, and
  specialized encodings live in the library's templates, not in your
  prompts.

- **Actionable error messages.** When a chart configuration is wrong, the
  library produces semantic explanations (*"Pyramid chart requires exactly
  2 categories; ‘Region’ has 5"*) that your agent can read and repair —
  no VL stack traces, no silent misrepresentation.

- **Multi-backend output from one spec.** The same semantic spec compiles
  to Vega-Lite, ECharts, or Chart.js. Your deployment context picks the
  backend; your agent and your prompts don't change.

### Key insight: semantic types as the contract

The root cause of your agent's brittleness is that charting APIs scatter
the semantic contract between data and chart across dozens of low-level
parameters. Consider a column containing `17234982372` — it could be a
Unix timestamp, a monetary value, a serial number, or a group ID. Today,
your agent must decide the encoding type (`temporal`, `quantitative`,
`nominal`), set axis formatting, configure zero-baseline behavior, choose
sizing — and these become hard-coded constants in the output that break
when the user edits anything.

**The fix:** instead of asking your agent to set these low-level details,
ask it to communicate one thing: **what does this data mean?** — expressed
through a fine-grained semantic type system (e.g., `Revenue`, `Rank`,
`Temperature`, `Year`). From the semantic type plus data characteristics
(cardinality, range, distribution), agents-chart's compiler automatically
derives:

- VL encoding type (quantitative / ordinal / nominal / temporal)
- Zero-baseline decision (Revenue → include zero; Temperature → don't)
- Domain padding (Rank → 8% pad so rank 1 isn't crushed against the axis)
- Axis sizing (spring model for discrete, per-axis stretch for continuous)
- Formatting, color schemes, and sort order

When the user changes a field or chart type, the compiler re-runs these
derivations with the new inputs. No agent call needed — the semantic types
from the original generation carry the information forward. This is why
**90% of user edits don't hit your agent at all**.

The main layout challenge is **coordinating sizing across axes, layers,
mark types, and facets** — parameters that are deeply interdependent
(e.g., facet count affects subplot width, which affects bar width, which
affects label rotation).

#### Parametric physics instead of manual heuristics

The conventional approach to this coordination problem — whether done by
your agent, by hand-coded post-processing, or by the charting library's
defaults — is **heuristic-based**: a pile of if/else rules and magic
numbers (`if bars > 30, rotate labels; if width > 800, shrink step`). These
heuristics are brittle because they don't compose: every new chart type,
every new facet structure, every new mark combination requires new rules.
You're always guessing thresholds, and the guesses break on data shapes you
didn't anticipate.

Agents-chart replaces this with a **parametric physics-inspired model**.
Instead of guessing layout constants, you control the system through a
small set of physics parameters with intuitive physical meaning:

| Parameter | Physical meaning | What it controls |
|-----------|-----------------|------------------|
| $\ell_0$ (rest length) | Natural spacing between items when unconstrained | Default bar/cell width before any compression |
| $k$ (spring stiffness) | Resistance to compression | How aggressively items shrink to fit the canvas |
| $\ell_{\min}$ (min length) | Hard floor — items never compress below this | Minimum readable bar/cell width |
| $W_{\max}$ (max canvas) | Maximum allowed canvas width | Upper bound on chart dimensions |
| $\beta_f$ (facet stretch) | How much extra canvas a facet adds | Trade-off between subplot density and total chart width |
| $P$ (pressure) | Outward force from continuous data density | How much a dense scatter/line plot stretches its canvas |

These parameters **compose naturally**. A faceted grouped bar chart doesn't
need special-case rules — the spring model runs per subplot, facet stretch
adjusts the container, and the parameters interact through the same physics
equations regardless of chart type. Change one parameter (e.g., raise
$\ell_{\min}$ to guarantee wider bars) and the system re-equilibrates
automatically — no cascade of broken heuristics.

This is a fundamental shift for agent developers: instead of maintaining
a growing library of layout heuristics that your agent or post-processing
must encode, you tune a handful of physics parameters that generalize
across all chart types, all facet structures, and all data shapes. The
parameters have physical intuition ("minimum bar width", "compression
resistance"), not arbitrary magic numbers.

Both the semantic type decisions and the
physics-based sizing are **library-agnostic** — they reason about data
meaning and visual density, not about any particular charting API. This
means the same compiler logic can target multiple rendering backends
without re-deriving the design rules.

### Why multiple backends matter to agent developers

As an agent developer, you may need to deploy to different contexts —
a lightweight mobile app, a desktop analytics tool, a static report.
No single charting library fits all of them, and each ecosystem carries
trade-offs:

| Backend | Strengths | Weaknesses |
|---------|-----------|------------|
| **Vega-Lite** | Grammar of graphics; declarative composition; strong faceting and layering | Heavy runtime (~400 KB); limited interactivity beyond tooltips; no canvas fallback; poor mobile performance |
| **ECharts** | Rich interactivity (zoom, brush, dataZoom); Canvas + SVG dual renderer; strong CJK locale support; built-in 3D | Imperative option-bag API; no grammar-of-graphics composition; verbose config for layered designs |
| **Chart.js** | Lightweight (~60 KB); Canvas-native (fast for large datasets); simple API; massive plugin ecosystem | No faceting; limited statistical charts; no declarative composition |
| **Plotly** | Scientific charts (contour, 3D surface); built-in statistical transforms; Dash integration | Very heavy runtime (~1 MB); opinionated styling; slower render for simple charts |

Without a backend-agnostic library like agents-chart, supporting
multiple renderers means **duplicating your entire agent pipeline per
backend** — prompts, examples, post-processing, validation, retry logic,
sizing heuristics. Every new backend multiplies the maintenance surface
by the number of chart types × the number of design rules. This is the
$B \times T \times R$ explosion: $B$ backends × $T$ templates × $R$ rules.

**Agents-chart's architecture collapses this to $T + (B \times I)$:**
the $T$ templates and $R$ rules live in shared Phases 0–1 (semantic
resolution + layout computation), and each backend only implements $I$
instantiation functions — thin translators that map the already-computed
layout and semantic decisions into the target library's config format.
Adding a new backend means writing instantiation code for each template,
not re-implementing the design system.

This isn't hypothetical. Agents-chart currently compiles the same
semantic spec to **three backends** — Vega-Lite, ECharts, and Chart.js —
sharing all semantic type logic, the spring/pressure layout model, and
overflow detection. The ECharts backend required zero changes to the
layout engine; the Chart.js backend required zero changes to semantic
resolution. Each new backend took days, not months, because the
expensive design work was already done.

**What this means for you as an agent developer:**

- **Deployment flexibility.** A dashboard embedded in a lightweight
  mobile app needs Chart.js (60 KB); the same dashboard in a data
  analyst's desktop tool uses Vega-Lite (full composition power).
  Your agent generates one spec; the deployment target picks the backend.
  Your prompts don't change.

- **Capability coverage.** No library has every chart type. Radar and
  gauge charts are native in ECharts but missing from Vega-Lite.
  Faceted layered compositions are native in Vega-Lite but painful in
  Chart.js. Agents-chart routes each chart type to the backend that
  handles it best — your agent doesn't need to know which.

- **Rendering trade-offs handled for you.** Canvas renderers (Chart.js,
  ECharts-canvas) handle 10K+ points without DOM pressure; SVG renderers
  (Vega-Lite) produce crisper output for publication. The choice depends
  on dataset size and output context — not on your agent's prompts.

- **Vendor independence.** Library APIs change, features get deprecated.
  When agents-chart is the contract — not the backend API — swapping or
  upgrading a renderer is a localized change, not a rewrite of your
  entire agent pipeline.

- **New backends are easy to add — even by coding agents.** The framework
  is explicitly designed so that adding a backend is a *mechanical
  translation* task: given the computed layout (canvas size, step widths,
  label angles, color mappings) and a target library's API, write the
  instantiation functions that produce that library's config format. This
  is exactly the kind of structured, well-scoped task that coding agents
  (Copilot, Cursor, Codex) excel at — they can scaffold a new backend
  from the existing ones as reference. Developers and designers then
  enhance the generated adapters with domain-specific design knowledge:
  fine-tuning animation defaults, theme integration, accessibility
  features, or library-specific optimizations that a code generator
  wouldn't know. The result is a **human-in-the-loop backend pipeline**
  where the mechanical work is automated and the design expertise is
  applied where it matters most.

### How your agent integrates

```
1. Your agent generates:  chart spec  +  semantic types for each field
                          (small JSON)    (e.g., Revenue, Year, Company)
   └─→ This is what your agent's prompt produces. ~7–12 lines.
   └─→ No VL knowledge, no sizing, no formatting.

2. User edits to explore:  swap field / change chart type / add facet
   └─→ agents-chart re-derives all config from semantic types  (NO agent call!)
   └─→ Chart looks good automatically  (98% of edits)

3. (Rare) Fine-tune:  user asks agent to edit underlying VL/ECharts
                       for detailed style customization  (2% of edits)
```

The chart spec is intentionally minimal. In Data Formulator, it's a small
JSON object returned alongside the data transformation code, so that
precious tokens go where they matter most: data computation and
transformation, not visualization plumbing.

---

## Side-by-Side: What Your Agent Has to Handle vs. What Agents-Chart Handles

Four examples that progressively demonstrate the gap between asking your
agent to generate charting code directly versus having it output a minimal
semantic spec that agents-chart compiles.

In every case, *the agents-chart spec is the same shape*: chart type +
field assignments + semantic types (~7–12 lines). What changes is how
much charting API config your agent would otherwise need to generate —
and how brittle that output is when users edit the chart.

### Example 1: Simple bar chart — no advantage yet

**Task:** Bar chart of Revenue by 5 Regions.

**With agents-chart:** Chart type, two field encodings, two semantic types.

**With your agent generating VL directly:** Mark type, two field encodings with
explicit `type` annotations.

The two are nearly identical in length and complexity. VL's defaults happen
to work: 5 bars at the default step size (20 px) produce a ~100 px chart
that fits comfortably, `zero: true` is correct for bars, and alphabetical
sort is acceptable for a few regions. **No win here — and that's the
point.** Agents-chart isn't designed to help with cases your agent already
handles well.

The advantages emerge as the chart gets more complex.

### Example 2: Lollipop chart — templates eliminate prompt complexity

**Task:** Lollipop chart of Revenue by Product (top 10), colored by Group
(values: 1, 2, 3, 4, 5 — categorical groups encoded as numbers).

**With agents-chart:** Chart type = "Lollipop Chart", three field encodings
(x, y, color), three semantic types (`Revenue`, `Product`,
`CategoryCode`). Same ~10 lines as any chart.

**What your agent's prompt must produce if generating VL directly:**
all of the following, correctly coordinated:

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

Other bespoke charts where agents-chart eliminates prompt complexity:

| Chart type | What your agent would need to generate in raw VL |
|------------|---------------------------------------------------|
| **Bump chart** | Layered line + circle, reversed Y, ordinal domain with padding |
| **Streamgraph** | Stack offset (`"center"`), area interpolation, series ordering |
| **Candlestick** | Layered rect + rule, open/close/high/low encoding, color by direction |
| **Waterfall** | Running sum transform, positive/negative coloring, connector rules |
| **Ridge plot** | Row-faceted density, overlapping layout, per-facet bandwidth |

### Example 3: Faceted bar chart — layout coordination your agent can't do

**Task:** Revenue by Product (80 products), faceted by Region (4 regions).

**With agents-chart:** Chart type, three field encodings (x, y, column),
three semantic types. Same ~12 lines.

**What your agent must hard-code if generating VL directly** — four
interdependent sizing decisions:

| Problem | What VL requires | Why it's hard |
|---------|-----------------|---------------|
| **Canvas size** | Hard-code `width` per subplot + `columns` for facet wrap | VL's default step size (20 px) × 80 products = 1600 px per subplot → 4 facets = 6400 px total. Wildly overflows. Must override with explicit `width: 380` and `columns: 2`, but these numbers depend on each other. |
| **Step / bar width** | Hard-code `step` or `width` to override VL's 20 px default | With `width: 380` for 80 bars, each bar is ~4.75 px — unreadable. Must also add `labelAngle: -90`, `labelLimit: 60`, `labelFontSize: 9`. If you use explicit `step` instead, you're back to choosing a step size that works for this cardinality but breaks for others. |
| **Facet wrapping** | Hard-code `columns` | 4 columns → each subplot is 190 px (bars unreadable). 1 column → page is 4× taller. 2 columns fits but per-subplot width must coordinate with total. |
| **Scale resolution** | `resolve.scale.x: "independent"` | Each facet may have different products — shared scale wastes space on absent categories. |

These decisions are **interdependent**: the number of facet columns
determines the available width per subplot, which determines the bar width,
which determines whether labels fit, which determines if label rotation and
truncation are needed. Your agent's prompt can't express these dependencies
— each value must be hard-coded, and they all break when the data changes.

With agents-chart, the spring model handles all three automatically:
- The facet stretch factor ($\beta_f$) determines the overall canvas growth.
- Each subplot runs its own spring model: 80 products × $\ell_0 = 20$ px
  overflows → items compress to $\ell = 8$ px, subplot stretches to fit.
- Label rotation and truncation are derived from the count and string
  lengths.
- The result: each bar is readable (8 px, not 2 px), the total width is
  controlled (not 6400 px), and facet columns are chosen to balance
  readability with compactness. Your agent doesn't touch any of this.

### Example 4: Heatmap with temporal × category — semantic types vs. guessing

**Task:** Heatmap of event counts — UTC timestamps (hourly, 30 days) on X,
Category (15 event types) on Y, count as color.

**With agents-chart:** Chart type = "Heatmap", three encodings (x, y, color),
three semantic types (`DateTime`, `Category`, `Count`). ~12 lines.

**What your agent must get right if generating VL directly** — 11 decisions,
all stemming from needing to know what the data *means*:

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

That's **11 decisions your agent must make correctly** in raw VL, all of
which agents-chart derives automatically from three semantic type
annotations.

If the timestamp column contained Unix epoch numbers (e.g., `1739600400`),
VL would default to `quantitative` — showing a continuous axis from 0 to
1.7 billion. The semantic type `DateTime` tells the compiler to treat it as
temporal regardless of the raw data format.

---

## Three Approaches You've Probably Tried

### Approach 1: Have your agent generate minimal VL (rely on defaults)

**Result: The spec is simple and editable, but the charts look bad —
and bespoke charts are impossible.**

This is the "keep it simple" approach: your agent generates just field
names, mark type, and data. The spec is easy for users to edit — swap a
field name and the chart re-renders. But the *quality* of what renders is
poor, because VL's defaults are generic heuristics that ignore both data
characteristics and semantic meaning.

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
detection nor cardinality checking distinguishes them. You can't solve this
in your agent's prompt or in post-processing — the only way to know the
correct encoding is to know what the data *means*.

**Bespoke charts are out of reach.** This approach can't produce bump
charts, candlestick charts, streamgraphs, waterfall charts, or radar
plots. These require specific mark layering, custom transforms, precise
scale configurations, and specialized encodings. Minimal VL generation
only covers basic bar / line / scatter / area charts.

**Bottom line:** The simple approach keeps your agent cheap and fast, but
your users get wrong-sized, semantically misleading charts limited to
basic types.

### Approach 2: Have your agent generate polished VL

**Result: The charts look great once, but every user edit breaks them —
and your agent gets called for every interaction.**

This is the "invest tokens in quality" approach. Your agent generates
detailed VL with tuned sizing, formatting, and encoding. It achieves
quality precisely by **hard-coding values tuned to the current data**:

| Hard-coded value | Breaks when… |
|------------------|-------------|
| `"width": 800` | User filters to 5 products (massive empty bars) or adds 200 (unreadable) |
| `"labelAngle": -45` | User swaps X to Region (3-letter labels don't need rotation) |
| `"domain": [0, 950000]` | User swaps Y to Temperature (wrong by 6 orders of magnitude) |
| `"mark.size": 8` | User switches to scatter with 1000 points (dots overlap completely) |
| `"scale.zero": true` | User swaps Y to Rank (zero-based rank wastes space, reads inverted) |
| `"format": "$,.0f"` | User swaps Y to Percentage (shows "$48" instead of "48%") |

The better your agent's output, the *more* hard-coded constants it
contains, and the *harder* the chart is to edit. This creates a vicious
cycle: **high-quality generation → brittle spec → forced regeneration
on every edit → high cost and latency → poor exploration experience.**
As the agent developer, you're paying for this cycle in API costs, user
frustration, and engineering time spent on retry logic.

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

This coordination is **the core brittleness problem for agent developers.**
There's no simple rule like "halve width → halve step" — the correct
adjustment depends on the data (cardinality, label lengths, value ranges),
the mark type, the encoding types, and the composition structure, all
simultaneously. You can't encode this in a prompt. A rule-based
post-processor would need to enumerate the full cross-product of parameter
interactions. Neither is practical — which is why every edit becomes
another LLM call from your agent.

**Structural rewrites are the worst case.** When *both* axes change
simultaneously, the parameter interactions multiply. Swapping Product→Year
and Revenue→Rank transforms a bar chart into a bump chart: the mark
changes from bar to line+circle (layered), X type changes from nominal to
ordinal, Y gets reversed with `zero: false` and domain padding, a color
channel appears, and width/height both change. No single-parameter edit
path exists — it's a complete structural rewrite that touches every level
of the spec simultaneously.

**The alternative: call your agent for every edit.** This works, but:

- **Expensive for you.** ~500–1000 tokens per call × 10–15 edits in a
  session = significant API cost. Each call takes 2–5 seconds — an
  interruption to your user's analytical flow.
- **Forces you to use expensive models.** Basic bar/line/scatter might work
  with a cheap model, but bespoke charts (bump, candlestick, waterfall)
  need layered marks, internal data transforms, and complex scale
  configurations. Only frontier models handle these reliably, and even
  they struggle with the correct combination of reversed scale + domain
  padding + tick count + layer composition.
- **The $F \times C$ combinatorial problem.** With 15 fields and 5 chart
  types, there are 75 possible configurations. Your agent handles each one
  individually — dozens of calls per exploration session.

**Bottom line:** Polished VL generation looks good once, but the spec is
too complex to edit, and regeneration per edit is slow, expensive, and
requires frontier models. As the agent developer, you're stuck maintaining
a brittle pipeline that costs more per user interaction.

### Approach 3: Use agents-chart

**Result: Good-looking *and* editable charts — your agent generates a
minimal JSON, and agents-chart handles everything else.**

Agents-chart is a **semantic-level visualization library** that compiles
to multiple charting backends. Your agent generates a minimal spec — chart
type, field assignments, and semantic types — and agents-chart's compiler
deterministically derives all the low-level parameters (sizing, zero
baseline, scale direction, formatting, sort, color scheme) from semantic
types + data characteristics. The result:

| Property | Approach 1 (defaults) | Approach 2 (polished VL) | Agents-chart |
|----------|-----------------------|--------------------------|--------------|
| **Looks good** | ✗ | ✓ | ✓ |
| **Editable** | ✓ (simple spec) | ✗ (brittle, hard-coded) | ✓ (semantic spec) |
| **Bespoke charts** | ✗ | Sometimes (frontier model) | ✓ (templates) |
| **Cost per user edit** | 0 (no agent call) | 1 agent call ($, latency) | 0 (no agent call) |
| **Agent complexity** | Low (just fields + mark) | High (coordinate 10–30 params) | Low (fields + semantic types) |
| **Model requirement** | N/A | Frontier for bespoke | Any (classification only) |

**What this means for your agent:**

Your agent's only job is **semantic classification** — assigning a type
like `"Revenue"`, `"Rank"`, `"Temperature"`, or `"Month"` to each data
field. This is one of the easiest tasks for any LLM (classify a column by
its meaning — even small, fast models do this reliably). From this single
annotation per field, agents-chart derives everything:

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

**Semantic types survive user edits.** When the user swaps Y from
Revenue to Temperature, agents-chart re-derives all parameters from
`"Temperature"` instead of `"Revenue"` and gets the right answer. No
hard-coded constant goes stale because there are no hard-coded constants.
The chart always looks good because sizing, zero behavior, and formatting
are computed fresh at compile time. **Your agent is not called.**

**The $F \times C$ problem becomes $F + C$.** Your agent classifies each
field once ($F$ decisions), the user picks a chart type ($C$ choices),
and agents-chart handles the cross-product. Instead of 75 configurations
that each need an agent call, the system needs 15 type assignments (done
once) and handles all 75 deterministically.

**Bespoke charts at zero additional agent complexity.** Agents-chart's
template system means bump charts, candlestick charts, streamgraphs,
waterfall charts, and ridge plots all take the same ~7-line spec as a
bar chart. The complexity (layered marks, custom transforms, reversed
scales, specialized encodings) lives in the library's templates, which are
tested and deterministic. Your agent doesn't need to understand layered VL
marks or polar coordinates — it just picks a chart type.

**The generated output is still accessible.** Agents-chart compiles to
standard Vega-Lite (or ECharts options, or Chart.js configs). If a user
needs to fine-tune a very specific visual detail (custom annotation, unusual
color breakpoints, bespoke interaction), they can edit the generated output
directly. The library handles the 98% of decisions that are derivable from
semantics; users override the remaining 2% in the output format.

**One agent spec, many rendering targets.** Because agents-chart operates
at a semantic level above any particular charting library, the same spec
your agent produces compiles to **Vega-Lite, ECharts, and Chart.js** today,
with Plotly, Observable Plot, or D3 as future targets. Your deployment
context picks the backend; your agent's code and prompts don't change.

This is not a theoretical claim. The three-phase pipeline makes it
concrete:

```
Phase 0 (shared):  Resolve semantic types → encoding types, zero behavior,
                   formatting, color schemes, sort order
Phase 1 (shared):  Compute layout → spring/pressure model → canvas size,
                   step sizes, label rotation, overflow warnings
Phase 2 (per-backend):  Instantiate → translate layout into VL spec,
                        ECharts option, or Chart.js config
```

Phases 0 and 1 contain ~90% of the design logic and are **identical
across backends**. Phase 2 is a thin translation layer — typically
50–100 lines per chart type — that maps the computed layout decisions
into the target library's configuration format. When we added the
Chart.js backend (9 chart types), not a single line of Phase 0 or
Phase 1 code changed. The semantic type system, the spring model, and
the overflow detection all worked unchanged — because they reason about
data and visual density, not about any particular API.

Build the semantic system once, target any chart library.

### Error handling: what your agent gets back when things go wrong

When your agent generates raw VL and the chart fails, failures are either
**catastrophic** (the chart crashes or renders at 2000 px × 80 px — the
user sees nothing useful) or **silent** (the chart renders without error
but misrepresents the data). VL gives only low-level errors (`"Invalid
specification"`) that neither your agent nor your user can act on.

With agents-chart, your agent gets **structured, semantic error messages**
that it can parse and repair automatically — or surface to the user as
actionable guidance.

**Semantic validation — agents-chart catches errors before rendering:**

| Violation | What agents-chart detects | What raw VL does |
|-----------|--------------------------|-----------------|
| **Chart–data incompatibility** | Pyramid chart requires exactly 2 categories and non-negative values. If the field has 5 categories or contains negative values (not counts), the compiler rejects with: *"Pyramid chart requires exactly 2 categories; 'Region' has 5"* or *"Pyramid chart requires non-negative values; 'Profit' contains negative values"* | VL renders a broken or nonsensical layered bar chart. No error. |
| **Redundant encoding** | Revenue mapped to both Y and color → *"Revenue is mapped to both Y and color — color adds no information"* | Renders silently with a gradient legend that duplicates the Y axis. User may not notice. |
| **Field–channel mismatch** | Nominal field on a quantitative-only channel, or too many categories for a color palette → *"Product has 80 values — too many for a color encoding"*. Numeric categorical values (e.g., Group codes 1–5) on color → *"Group is a CategoryCode — use nominal, not quantitative"* (see Example 2) | Renders 80 nearly-indistinguishable colors, or maps numeric categories to a continuous gradient where groups 1 and 2 get identical shades. No warning either way. |
| **Missing required encoding** | Candlestick without high/low fields → *"Candlestick chart requires Open, High, Low, Close fields"* | Crashes or renders partial marks with no explanation. |

**Overflow detection — agents-chart explains *why* a chart was clipped,
so your agent can suggest fixes:**

| Scenario | Agents-chart response | Raw VL result |
|----------|----------------------|---------------|
| **80 products × 4 facets** | Spring model detects overflow. Report: *"X axis clipped: 80 products compressed from 20 px to 8 px per bar; canvas stretched from 400 px to 800 px (max). Consider filtering to top 20."* | 6400 px wide chart with horizontal scrolling, or a 400 px chart with 5 px bars — no explanation of why. |
| **720 temporal cells on heatmap** | *"Heatmap X axis: 720 hourly cells compressed to 1.1 px each. Consider aggregating to daily (30 cells) for readability."* | 14,400 px wide, or hard-coded to 400 px with 0.5 px cells — a solid color band. |
| **50 facets × 10 categories** | *"Facet overflow: 50 subplots cannot fit readable bars. Showing top 12 facets; 38 truncated."* — with each subplot still containing readable 6 px bars. | 400 px chart with 50 squished facets, each containing 10 unreadable 0.8 px bars. Technically renders but useless. |

The key difference for agent developers: **agents-chart failures are
diagnostic and recoverable** — your agent receives structured messages
that explain what's wrong, why it's wrong, and what to do about it. Raw VL
failures are either invisible (silent misrepresentation) or opaque (a
crashed render that your retry loop can't fix).
