# Agents-Chart: Design Details

> Sizing models and semantic type system for the `agents-chart` library.
>
> This document covers the technical design details: spring model, pressure
> model, and semantic type hierarchy. For the full system architecture, see
> [design_v3.md](design_v3.md). For motivation, examples, and Q&A, see
> [story.md](story.md).
>
> For extended model documentation:
> [design-stretch-model.md](design-stretch-model.md),
> [design-semantic-types.md](design-semantic-types.md).

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