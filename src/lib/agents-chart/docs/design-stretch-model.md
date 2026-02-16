# Design: Axis Layout Compression

This document describes the physics-based model for automatically sizing chart axes when data overflows the available canvas. Two models cover the two fundamentally different axis types:

- **Discrete axes** (§1): banded items with fixed slots — modeled as **springs in a box**.
- **Continuous axes** (§2): point-like items in a 2D region — modeled as **gas pressure in a container**.

Both models share the same three-regime structure (fits → elastic equilibrium → overflow) but differ in how pressure is generated and how the system responds.

---

# §0 Definitions: Banded vs Non-banded Layout

## Two independent classification axes

The layout model needs to decide **how** to allocate space for each positional axis. This decision depends on two independent properties:

1. **Scale type** — the Vega-Lite encoding type of the field.
2. **Mark geometry** — whether the mark occupies a fixed-width band or a point-like position.

These two properties combine to determine the **layout mode** for each axis.

## Layout modes

### Banded layout

A **banded** axis allocates a fixed-width slot (band) to each data position. The layout model controls the step size per slot. Items are read by the width/area of their band.

A banded axis arises from **any** of the following:

| Condition | Example |
|---|---|
| **Discrete scale** (nominal / ordinal) | Categories on a bar chart, ordinal months |
| **Continuous scale + band mark** | A bar chart with a quantitative or temporal X axis (years as numbers, not categories) |
| **Binned axis** (`bin: true`) | Histogram bins — each bin is a band regardless of underlying scale |

### Non-banded layout

A **non-banded** axis places items at data-determined positions within a continuous range. The layout model controls the overall canvas size but does **not** allocate per-item slots. Items are read by their position along the scale.

A non-banded axis arises when:

| Condition | Example |
|---|---|
| **Continuous scale + point mark** | Scatter plot, line chart, area chart |

### Decision tree

```
For each positional axis (x, y):

1. Is the VL encoding type nominal or ordinal?
   → YES: Banded (discrete). Use §1 spring model directly.

2. Is the axis binned (enc.bin = true)?
   → YES: Banded (continuous). Use §1 spring model with bin count as N.

3. Does the template declare this axis as banded?
   (axisFlags.banded = true, e.g. bar/rect/boxplot marks)
   → YES: Banded (continuous). Use §1 spring model with field cardinality as N.

4. Otherwise:
   → Non-banded (continuous). Use §2 gas pressure model.
```

### Summary matrix

|  | Band mark (bar, rect, boxplot) | Point mark (circle, line, area) |
|---|---|---|
| **Discrete scale** (N/O) | Banded — §1 spring model | Banded — §1 spring model (*) |
| **Continuous scale** (Q/T) | Banded — §1 spring model | Non-banded — §2 gas model |

(*) Discrete scales are always banded regardless of mark type, because VL allocates a band per category. A scatter plot on a nominal axis still gets step-based layout.

## Implementation note: Discrete vs Continuous banded in Vega-Lite

The spring model (§1) applies to both discrete-banded and continuous-banded axes, but the **Vega-Lite implementation differs** between the two cases:

### Discrete banded (nominal / ordinal)

VL natively supports step-based sizing for discrete scales. We simply set:

```json
{ "width": { "step": ℓ } }
```

or `{ "height": { "step": ℓ } }`, where $\ell$ is the computed step size from the spring model. VL handles the rest — it creates a band scale, allocates $\ell$ pixels per category, and sizes the chart to $N \times \ell$.

For grouped bars (xOffset / yOffset), we use:

```json
{ "width": { "step": ℓ_group, "for": "position" } }
```

so the step controls the **group** width, not individual sub-bars.

### Continuous banded (quantitative / temporal + band mark)

VL does **not** support `{ "step": N }` on continuous scales — it will reject it. Instead, we must control the layout ourselves in two phases:

**Phase 1 (assemble.ts): Canvas sizing.** Compute the canvas size from the step size and item count, as if it were discrete:

```
continuousWidth = stepSize × (N + 1)
```

The extra `+1` adds half-step padding on each side so marks aren't flush against axis edges. This value is set via `config.view.continuousWidth` / `continuousHeight`.

We also set the scale domain to extend by half a data-step on each side:

```
domain = [min - halfStep, max + halfStep]
```

where `halfStep = dataRange / (N - 1) / 2`. This ensures the VL continuous scale maps positions to the same pixel locations that a discrete band scale would.

**Phase 2 (postProcessing / adjustBarMarks): Mark sizing.** Since VL won't auto-size bars on a continuous scale, we explicitly set the mark width/height. The mark size is derived from the **minimum gap** between the two closest data values:

1. Sort all unique field values numerically.
2. Find `minGap` = smallest difference between consecutive values.
3. Convert to pixels: `pixelsPerUnit = subplotDim × (N-1) / (dataRange × N)`
4. `markSize = min(stepSize × 0.9, floor(minGap × pixelsPerUnit))`

This ensures bars don't overlap even when data values are irregularly spaced. The `0.9` fill ratio leaves a small gap between bars (similar to VL's default band padding for discrete scales).

The mark size is applied directly to the mark definition:

```json
{ "mark": { "type": "bar", "size": markSize } }
```

For rect marks (heatmaps), `width` and `height` properties are used instead of `size`, with a tighter `0.98` fill ratio for near-edge-to-edge tiling.

### Comparison

| Aspect | Discrete banded | Continuous banded |
|---|---|---|
| VL scale type | `nominal` / `ordinal` (band scale) | `quantitative` / `temporal` (linear/time scale) |
| Step control | `{ "step": ℓ }` on width/height | Manual: `config.view.continuousWidth = ℓ × (N+1)` |
| Mark sizing | Automatic (VL fills bands) | Manual: `mark.size` from min-gap calculation |
| Domain padding | Automatic (band scale) | Manual: extend domain by ±halfStep |
| Overflow truncation | Truncate categories | Not applicable (continuous scale shows full range) |
| Sort control | `encoding.sort` | Data-determined (continuous scale) |

### When to prefer continuous banded over discrete

Continuous banded layout is preferred when:

- The data has **natural ordering and arithmetic meaning** (years, dates, prices) — converting to ordinal would lose the proportional spacing.
- The data has **irregular spacing** — a continuous scale correctly positions items proportionally, while a discrete scale would show uniform bands hiding the gaps.
- The template explicitly declares `axisFlags.banded = true` while keeping the VL encoding type as quantitative/temporal.

The `detectBandedAxis` function in `templates/utils.ts` handles this decision: when both axes are continuous (Q×Q, T×Q, T×T), it returns the preferred axis as banded **without converting** the encoding type, relying on `axisFlags` to trigger the continuous-banded pipeline.

---

# §1 Discrete Axis (Spring Model)

## Problem

A discrete axis displays $N$ banded items (categories, bins, groups) along a 1D segment of length $L_0$ pixels. Each item ideally occupies $\ell_0$ pixels (the natural length). When $N \cdot \ell_0 > L_0$, the items overflow. The system must decide how to resolve this by balancing two competing goals:

1. **Items resist compression** — each item pushes outward to maintain its natural length $\ell_0$, and cannot shrink below a hard minimum $\ell_{\min}$.
2. **The axis resists expansion** — the axis can stretch beyond $L_0$ but resists growing, with a hard maximum of $L_{\max} = (1 + \beta) \cdot L_0$.

## Setup

| Symbol | Meaning | Vega-Lite / Code mapping | Example default |
|---|---|---|---|
| $L_0$ | Natural (rest) axis length | `width` / `height` (canvas size) | 400px |
| $L_{\max}$ | Maximum axis length, $(1 + \beta) \cdot L_0$ | `width * maxStretch` | 800px |
| $\beta$ | Maximum stretch ratio | `maxStretch - 1` | 1.0 |
| $N$ | Number of banded items on the axis | cardinality of the encoding field | data-dependent |
| $\ell_0$ | Natural (rest) length per item | `{"step": N}` on width/height | ~20px |
| $\ell_{\min}$ | Minimum length per item (solid length) | `minStep` option | 6px |
| $k_1$ | Spring constant of each item | — (not directly exposed) | tunable |
| $k_2$ | Spring constant of the wall (axis) | — (not directly exposed) | tunable |
| $\kappa$ | Stiffness ratio $\kappa = k_1 / k_2$ | `elasticity` option | 1.0 |

## Three Regimes

### Regime 1: No compression needed

**Condition:** $N \cdot \ell_0 \leq L_0$

All items fit at their natural length. The axis length is $N \cdot \ell_0$ and each item gets exactly $\ell_0$ pixels. No forces are involved.

$$\ell = \ell_0, \quad L = N \cdot \ell_0$$

### Regime 2: Overflow beyond recovery

**Condition:** $N \cdot \ell_{\min} \geq L_{\max}$

Even at minimum item length and maximum axis stretch, not all items fit. The axis stretches to $L_{\max}$, items shrink to $\ell_{\min}$, and excess items are truncated (removed, with a warning).

$$N' = \left\lfloor \frac{L_{\max}}{\ell_{\min}} \right\rfloor$$

Keep the top $N'$ items (ranked by importance), discard the remaining $N - N'$.

$$\ell = \ell_{\min}, \quad L = L_{\max}$$

### Regime 3: Elastic equilibrium

**Condition:** $N \cdot \ell_0 > L_0$ and $N \cdot \ell_{\min} < L_{\max}$

Items overflow but can be accommodated by compressing items and/or stretching the axis. The system finds an equilibrium between the items' outward push and the axis's inward resistance.

This is where the physics model applies.

---

## Formalization

### Physical model: Items as springs against a wall

Imagine $N$ identical springs (items) packed horizontally inside a box (the axis). Each spring has:

- **Natural length** $\ell_0$ (ideal step size)
- **Solid length** $\ell_{\min}$ (minimum step size — coils bottomed out)
- **Spring constant** $k_1$

The box has:

- **Natural length** $L_0$ (default axis length)
- **Maximum length** $L_{\max} = (1 + \beta) \cdot L_0$ (the wall can be pushed out but no further)
- **Spring constant** $k_2$ (wall resistance)

At equilibrium, the total compression force from the springs equals the resistance force from the wall.

### Force definitions

**Item (spring) force.** When an item is compressed from $\ell_0$ to length $\ell$ (where $\ell_{\min} \leq \ell \leq \ell_0$), it exerts outward force:

$$F_1(\ell) = k_1 \cdot (\ell_0 - \ell)$$

With $N$ items, the total outward force:

$$F_{\text{total}} = N \cdot k_1 \cdot (\ell_0 - \ell)$$

**Wall (axis) force.** When the axis stretches from $L_0$ to $L = N \cdot \ell$ (where $L_0 \leq L \leq L_{\max}$), the wall pushes back:

$$F_2(L) = k_2 \cdot (L - L_0) = k_2 \cdot (N \cdot \ell - L_0)$$

### Equilibrium condition

At equilibrium:

$$F_{\text{total}} = F_2$$

$$N \cdot k_1 \cdot (\ell_0 - \ell) = k_2 \cdot (N \cdot \ell - L_0)$$

Solving for $\ell$:

$$\ell = \frac{N \cdot k_1 \cdot \ell_0 + k_2 \cdot L_0}{N \cdot (k_1 + k_2)}$$

Using the stiffness ratio $\kappa = k_1 / k_2$:

$$\boxed{\ell = \frac{\kappa \cdot \ell_0 + L_0 / N}{1 + \kappa}}$$

This has a clean interpretation:

- When $\kappa \to \infty$ (items infinitely stiff, wall is soft): $\ell \to \ell_0$. Items don't compress at all; the wall absorbs everything.
- When $\kappa \to 0$ (items are soft, wall is rigid): $\ell \to L_0 / N$. Items compress to fit the fixed axis.
- At $\kappa = 1$: $\ell = (\ell_0 + L_0/N) / 2$. The compression is split evenly — items shrink halfway and the axis stretches halfway.

The axis length at equilibrium:

$$L = N \cdot \ell = \frac{N \cdot \kappa \cdot \ell_0 + L_0}{1 + \kappa}$$

### Clamping

After computing the equilibrium $\ell$:

$$\ell_{\text{final}} = \operatorname{clamp}(\ell,\ \ell_{\min},\ \ell_0)$$

$$L_{\text{final}} = \operatorname{clamp}(N \cdot \ell_{\text{final}},\ L_0,\ L_{\max})$$

If $L_{\text{final}}$ is clamped at $L_{\max}$, recompute $\ell_{\text{final}} = L_{\max} / N$ and check against $\ell_{\min}$ (which triggers Regime 2 truncation if violated).

### Nonlinear (progressive-rate) spring variant

The linear model above gives a uniform split. In practice, we may want **progressive resistance**: items should resist more strongly as they approach $\ell_{\min}$ (like a progressive-rate car suspension spring). This replaces the linear spring with:

$$F_1(\ell) = k_1 \cdot \left(\frac{\ell_0 - \ell}{\ell_0 - \ell_{\min}}\right)^{\gamma}$$

where $\gamma > 1$ means the force increases sharply as $\ell \to \ell_{\min}$ (hardening spring). This is related to the current implementation's `pressure^elasticity` formulation:

$$\text{stretch} = \min\left(1 + \beta,\ p^{\alpha}\right)$$

where $p = N \cdot \ell_0 / L_0$ is the pressure ratio and $\alpha < 1$ is the elasticity exponent.

With $\alpha = 0.5$, this is a square-root curve — doubling the overflow only increases the stretch by $\sqrt{2} \approx 1.41\times$.

### Relationship between the two formulations

| Linear spring model | Current implementation |
|---|---|
| $\kappa$ (stiffness ratio $k_1/k_2$) | $\alpha$ (elasticity exponent) |
| $\ell = (\kappa \cdot \ell_0 + L_0/N) / (1 + \kappa)$ | $\ell = L_0 \cdot p^{\alpha-1} / N$ where $p = N\ell_0/L_0$ |
| Uniform interpolation between $\ell_0$ and $L_0/N$ | Power-curve interpolation favoring $\ell_0$ |
| Easy to reason about | More compact, single parameter |

The current power-law model is simpler (one parameter $\alpha$ instead of two spring constants) and naturally progressive. The linear spring model is more physically intuitive and allows independent tuning of item vs. wall stiffness.

### Recommended model

The **linear spring model** $\ell = (\kappa \cdot \ell_0 + L_0/N) / (1 + \kappa)$ is recommended as the primary mental model because:

1. **Interpretable**: $\kappa$ directly answers "how much do items resist vs. the wall?"
2. **Separable**: the stiffness ratio $\kappa$ can vary per chart type (bars may be stiffer than scatter points)

The power-law variant can be used as an enhancement when progressive stiffening near $\ell_{\min}$ is desired.

### Grouped items (grouped bars, jitter plots)

Grouped items (e.g., a grouped bar chart with $m$ sub-bars per group, or a jitter/strip plot with multiple points per band) are treated as a special case of the discrete spring model — **not** as a separate continuous-within-band problem. The group is the unit of compression.

The simplification: replace the per-item parameters $\ell_0$ and $\ell_{\min}$ with group-level equivalents that account for the internal structure:

| Parameter | Simple discrete | Grouped bar ($m$ sub-bars) | Jitter plot |
|---|---|---|---|
| $\ell_0$ (natural length) | `defaultStepSize` | $m \cdot$ `defaultStepSize` | higher than default (needs room for spread) |
| $\ell_{\min}$ (solid length) | `minStep` (6px) | $2m$ px (2px per sub-bar) | `minStep` (unchanged) |
| $\kappa$ (stiffness) | default | higher (groups resist compression more — losing sub-bar distinction is costly) | higher (jittered points overlap rapidly under compression) |
| $N$ (item count) | cardinality of field | number of **groups** (not sub-bars) | cardinality of discrete field |

The equilibrium formula is unchanged:

$$\ell = \frac{\kappa \cdot \ell_0 + L_0 / N}{1 + \kappa}$$

but with the group-level $\ell_0$, $\ell_{\min}$, $\kappa$, and $N$ substituted. This keeps the model uniform — no nested spring-in-spring composition needed. The internal structure of the group only affects the parameter values, not the model itself.

**Example:** A grouped bar chart with 5 groups, 3 sub-bars each, on a 400px axis:
- $N = 5$ (groups), $\ell_0 = 3 \times 20 = 60$ px, $\ell_{\min} = 3 \times 2 = 6$ px
- Ideal total: $5 \times 60 = 300 \leq 400$ → Regime 1, no compression needed.

**Example:** Same chart with 15 groups:
- $N = 15$, $\ell_0 = 60$, ideal total = $900 > 400$ → Regime 3.
- With $\kappa = 1.5$: $\ell = (1.5 \times 60 + 400/15) / 2.5 = (90 + 26.7) / 2.5 = 46.7$ px per group.
- Axis length: $15 \times 46.7 = 700$ px (stretch factor 1.75).

### Per-mark-type defaults

Different mark types have different visual footprints and tolerances for compression. A fat bar needs more room than a thin lollipop stem; a heatmap cell is essentially incompressible below a few pixels. The model accommodates this by varying $\ell_0$, $\ell_{\min}$, and $\kappa$ per chart type.

**Suggested defaults** (for a 300px reference canvas, `defaultStepSize` = 20px):

| Mark type | $\ell_0$ | $\ell_{\min}$ | $\kappa$ | Rationale |
|---|---|---|---|---|
| **Bar** | 20px | 6px | 1.0 | Standard band; moderate resistance. Bar width directly encodes the item — can't shrink too much. |
| **Stacked bar** | 20px | 6px | 1.2 | Slightly stiffer — stacked segments become unreadable when thin. |
| **Grouped bar** ($m$) | $20m$ px | $2m$ px | 1.5 | Group needs room for sub-bars. Higher stiffness: losing sub-bar distinction is costly. |
| **Lollipop** | 14px | 4px | 0.5 | Narrow stem + dot. Low stiffness — lollipops compress gracefully because the dot (position) carries the encoding, not the width. |
| **Heatmap / rect** | 20px | 8px | 2.0 | Color-filled cell. High stiffness — cells need enough area for color to be perceivable. High $\ell_{\min}$ because a 3px rect is useless. |
| **Boxplot** | 24px | 10px | 1.5 | Needs room for box, whiskers, and median line. Stiff — internal structure is lost early under compression. |
| **Strip / jitter** | 24px | 6px | 1.2 | Needs horizontal room for jitter spread. Moderately stiff — points collapse into a line when too narrow. |
| **Histogram** | 16px | 4px | 0.6 | Bins can be narrow; the shape (distribution) survives compression well. More compressible than bars. |
| **Bump chart** | 16px | 6px | 0.8 | Position-based reading; moderate compression tolerance. |
| **Candlestick** | 18px | 8px | 1.5 | Needs room for open/close body + wicks. Internal structure is fragile. |

**Design principles behind the table:**

1. **Marks encoding value by width/area** (bar, rect, heatmap) have higher $\ell_0$ and $\kappa$ — compression directly degrades the encoding.
2. **Marks encoding value by position** (lollipop, bump) have lower $\kappa$ — they compress gracefully because position survives scaling.
3. **Marks with internal structure** (boxplot, candlestick, grouped bar) have higher $\ell_{\min}$ and $\kappa$ — the subcomponents become indistinguishable early.
4. **Marks showing distribution shape** (histogram) can be narrower — the aggregate pattern matters, not individual bar width.

Templates can override these defaults via `overrideDefaultSettings` in the chart template definition. The `defaultStepMultiplier` option scales $\ell_0$ proportionally for templates that need globally larger or smaller steps.

### Faceted charts

Faceting splits one chart into a grid of subplots (small multiples), each showing a subset of the data. This introduces an additional layer of layout compression: the canvas must now accommodate $F$ facet panels, each of which contains its own axis with banded or continuous items.

**Key idea:** Facets introduce a **second stretch factor** $\beta_f$ on top of the canvas size. The total canvas can grow by up to $(1 + \beta_f)$ to accommodate facets, but each subplot shrinks as the number of facets increases.

#### Setup (facet-level)

| Symbol | Meaning | Vega-Lite / Code mapping | Example default |
|---|---|---|---|
| $F_c$ | Number of facet columns | cardinality of `column` / `facet` field | data-dependent |
| $F_r$ | Number of facet rows | cardinality of `row` field | data-dependent |
| $\beta_f$ | Facet stretch ratio (canvas can grow up to $(1 + \beta_f) \cdot L_0$) | `facetMaxStretch - 1` | 0.5 |
| $\alpha_f$ | Facet elasticity exponent | `facetElasticity` | 0.3 |
| $S_{\min}$ | Minimum subplot size (continuous axis) | `minSubplotSize` | 60px |
| $\ell_{\min}^{f}$ | Facet-mode minimum band size (overrides $\ell_{\min}$) | — | 3px |
| $S_{\min}^{\text{ridge}}$ | Minimum subplot size for ridge-style layouts | — | 20px |

#### Facet-mode shrink limits

When facets are present, the axis is allowed to shrink **further** than in the single-chart case, because each subplot carries less visual responsibility — the reader compares patterns across panels rather than reading individual values precisely.

**Banded items:** In a single chart, $\ell_{\min} = 6\text{px}$ ensures each bar/band is individually readable. Under faceting, the priority shifts to fitting the overall grid. Banded items can shrink to a tighter floor $\ell_{\min}^{f}$:

$$\ell_{\min}^{f} = \max(2,\ \ell_{\min} / 2)$$

This allows bars to go down to ~3px — too thin to read individual values, but sufficient to see the distribution shape across facets.

**Continuous axes:** In a single chart, continuous axes stay at the canvas size. Under faceting, subplots can shrink to $S_{\min}$ (default 60px). For specialized layouts like ridge plots (row-faceted density curves), subplots can be much shorter:

$$S_{\min}^{\text{ridge}} \approx 20\text{px}$$

because each row only needs enough height to render a single density curve.

**Per-mark-type facet minimums:**

| Mark type | $\ell_{\min}^{f}$ (banded) | $S_{\min}$ (continuous) | Rationale |
|---|---|---|---|
| Bar / stacked bar | 3px | 60px | Shape visible at 3px; continuous axis needs room for ticks |
| Heatmap / rect | 4px | 40px | Color cell; can be quite small and still convey hue |
| Boxplot | 6px | 60px | Internal structure needs minimum room even in facets |
| Line / area | — | 40px | No bands; continuous subplot can be compact |
| Ridge / density | — | 20px | Each row is a single curve; very compact |
| Scatter | — | 60px | Needs 2D area for point separation |

#### Subplot sizing

Each subplot gets a share of the (possibly stretched) canvas. For columns:

$$W_{\text{sub}} = \max\left(S_{\min},\ \frac{W_0 \cdot \lambda_f}{F_c}\right)$$

where $\lambda_f = \min(1 + \beta_f,\ F_c^{\alpha_f})$ is the facet stretch factor. The same applies to rows with $H_0$ and $F_r$.

The facet stretch uses a gentler exponent ($\alpha_f = 0.3$) and tighter cap ($\beta_f = 0.5$) than discrete item compression, because each subplot is a self-contained chart — even a small subplot can be readable, whereas a 3px bar cannot.

#### Case 1: Faceted discrete axis

When facets are laid out along the same dimension as a discrete axis (e.g., column facets with a discrete X axis), the banded items from **all facet panels** contribute to the total pressure on that dimension.

The total number of band positions along the axis dimension is:

$$N_{\text{total}} = N_{\text{items}} \cdot F_c$$

But since each facet panel is independent (items don't span across panels), we compute the pressure **per subplot**: the subplot width $W_{\text{sub}}$ becomes the container length $L_0$ for the spring model, and $N_{\text{items}}$ is the item count within each panel.

$$\ell = \frac{\kappa \cdot \ell_0 + W_{\text{sub}} / N_{\text{items}}}{1 + \kappa}$$

When overflow occurs (Regime 2):
1. First, apply maximum compression: all bands shrink to $\ell_{\min}$.
2. If $N_{\text{items}} \cdot \ell_{\min} > W_{\text{sub}}$, truncate to $N' = \lfloor W_{\text{sub}} / \ell_{\min} \rfloor$ items per panel.
3. The total canvas width is capped at $(1 + \beta_f) \cdot W_0$.

#### Case 2: Faceted continuous axis

The same subplot sizing applies. The continuous gas pressure model runs within each subplot using $A_{\text{sub}} = W_{\text{sub}} \times H_{\text{sub}}$ as the container area. Since continuous axes don't have per-item slots, the pressure is local to each panel:

$$P_i = \frac{n_i \cdot \sigma}{A_{\text{sub}}}$$

where $n_i$ is the number of data points in facet panel $i$. Each panel may have different density, but the subplot dimensions are uniform (all panels get the same size for visual consistency).

#### Case 3: Facet wrap (column-only folding)

When only a column facet is specified (no row), and the number of facet values $F$ is large, the system **wraps** the panels into a grid by folding onto the opposite dimension.

**Step 1: Determine columns.** Given the available width and minimum subplot size, compute the maximum number of columns:

$$F_c = \min\left(F,\ \left\lfloor \frac{(1 + \beta_f) \cdot W_0}{S_{\min}} \right\rfloor\right)$$

Also consider the internal discrete pressure: if each subplot has $N_{\text{items}}$ banded items, the minimum subplot width is $N_{\text{items}} \cdot \ell_{\min}$, which further constrains $F_c$:

$$F_c = \min\left(F_c,\ \left\lfloor \frac{(1 + \beta_f) \cdot W_0}{N_{\text{items}} \cdot \ell_{\min}} \right\rfloor\right)$$

**Step 2: Compute rows.** The number of rows is determined by wrapping:

$$F_r = \lceil F / F_c \rceil$$

**Step 3: Compute subplot sizes.** Now both dimensions have their facet counts, and the spring model runs per-subplot as in Case 1/2:

$$W_{\text{sub}} = \max\left(S_{\min},\ \frac{W_0 \cdot \min(1 + \beta_f,\ F_c^{\alpha_f})}{F_c}\right)$$

$$H_{\text{sub}} = \max\left(S_{\min},\ \frac{H_0 \cdot \min(1 + \beta_f,\ F_r^{\alpha_f})}{F_r}\right)$$

The wrapping transfers pressure from the horizontal dimension to the vertical — folding into more rows reduces column count, giving each subplot more width, but the total chart height grows.

---

## §1 Summary

| Symbol | Physics name | Chart meaning |
|---|---|---|
| $N$ | Number of bodies | Number of discrete items |
| $\ell_0$ | Natural (rest) length | Ideal step size |
| $\ell_{\min}$ | Solid length | Minimum step size |
| $\ell$ | Compressed length | Computed step size |
| $L_0$ | Container rest length | Default axis length |
| $L_{\max}$ | Container max length | Maximum axis length |
| $k_1$ | Item spring constant | Item compression resistance |
| $k_2$ | Wall spring constant | Axis expansion resistance |
| $\kappa$ | Stiffness ratio $k_1/k_2$ | Elasticity parameter |
| $\gamma$ | Hardening exponent | Progressive rate factor |
| $\beta$ | Stretch ratio | Max stretch - 1 |

```
Given: N items, natural length ℓ₀, solid length ℓ_min,
       axis rest length L₀, max stretch β, stiffness ratio κ

if N·ℓ₀ ≤ L₀:
    ℓ = ℓ₀                              # Regime 1: fits

elif N·ℓ_min ≥ (1+β)·L₀:
    ℓ = ℓ_min, truncate to N' items      # Regime 2: overflow

else:
    ℓ = (κ·ℓ₀ + L₀/N) / (1 + κ)         # Regime 3: equilibrium
    ℓ = clamp(ℓ, ℓ_min, ℓ₀)
    L = clamp(N·ℓ, L₀, (1+β)·L₀)
```

---

# §2 Continuous Axis (Gas Pressure Model)

## Problem

A continuous axis displays $N$ point-like items (scatter dots, line vertices, etc.) across a canvas region. Unlike discrete items, these marks do not occupy fixed bands — they float at data-determined positions within a 2D area $A = W \times H$. Each mark has a visual cross-section $\sigma$ (the area it occupies in pixels, e.g. $\pi r^2$ for a circle of radius $r$).

The question is: given $N$ marks of size $\sigma$ in a region of area $A$, how much should the axis expand to keep the chart readable?

## Why springs don't apply here

In the discrete model, each item has a **slot** — a 1D segment it exclusively owns. Compression means shrinking that slot. But continuous marks don't own slots. A scatter plot with 100 points and one with 10 points can both fit in the same 400×300 canvas — the difference is **density**, not per-item allocation.

This is the domain of gas physics: $N$ particles with cross-section $\sigma$ in a container of volume (area) $A$.

## Setup

| Symbol | Meaning | Code mapping | Default |
|---|---|---|---|
| $W_0$ | Natural canvas width | `continuousWidth` | 400px |
| $H_0$ | Natural canvas height | `continuousHeight` | 320px |
| $\sigma$ | Cross-section per mark (px²) | `markCrossSection` | ~30 px² |
| $\sigma_x, \sigma_y$ | Per-axis cross-sections | `markCrossSectionX/Y` | chart-type specific |
| $\alpha_c$ | Elasticity exponent | `elasticity` | 0.3 |
| $\beta_c$ | Maximum stretch ratio | `maxStretch - 1` | 0.5 (up to 1.5×) |

## Why per-axis

Crowding on a continuous chart is almost always asymmetric between axes:

- On a **scatter plot**, both axes have similar density — but even here,
  the X and Y distributions can differ wildly.
- On a **line chart**, X crowding is driven by the number of time points
  while Y crowding is driven by the number of overlapping series.
- On a **stacked bar** (continuous Y, discrete X), only the continuous
  axis has density pressure at all.

An isotropic model (stretch both axes equally) wastes space on the
uncrowded axis and under-stretches the crowded one. Per-axis stretch is
both more general and more accurate.

## Per-axis stretch model

Each axis is stretched independently based on 1D pressure along that axis.
There are two modes:

### Mode 1: Positional (default)

Count how many **unique pixel positions** compete for space along the axis.
This is the right measure for scatter plots and the X axis of line charts.

$$\sigma_{1d} = \sqrt{\sigma}$$

The 1D projection of a 2D cross-section $\sigma$ (e.g., a circle of area
$\sigma = 30$ px² projects to a diameter of $\sqrt{30} \approx 5.5$ px).

Unique positions are bucketed at ~1px resolution:

$$\text{uniquePos} = |\{ \lfloor (v - d_{\min}) \cdot \text{px/unit} + 0.5 \rfloor : v \in \text{data} \}|$$

1D pressure:

$$p_{1d} = \frac{\text{uniquePos} \cdot \sigma_{1d}}{\text{dim}_0}$$

Stretch:

$$s = \begin{cases}
1 & \text{if } p_{1d} \leq 1 \\
\min(1 + \beta_c,\ p_{1d}^{\,\alpha_c}) & \text{if } p_{1d} > 1
\end{cases}$$

### Mode 2: Series-count (`seriesCountAxis`)

When `seriesCountAxis` is set (`'x'`, `'y'`, or `'auto'`), the designated
axis uses the number of distinct series for pressure instead of unique pixel
positions. `'auto'` resolves to:
- In the 2D path (both axes continuous, e.g. line chart): Y axis.
- In the 1D path (one continuous + one discrete, e.g. stacked bar): the
  continuous axis (whichever it is).

$$n_{\text{series}} = |\text{distinct values of color} \cup \text{detail fields}|$$

$$p_{\text{series}} = \frac{n_{\text{series}} \cdot \sigma}{\text{dim}_0}$$

Here $\sigma$ is used **directly** (not square-rooted) since series count
is inherently 1D — each series "wants" $\sigma$ pixels of space on the
series axis.

$$s = \begin{cases}
1 & \text{if } p_{\text{series}} \leq 1 \\
\min(1 + \beta_c,\ p_{\text{series}}^{\,\alpha_c}) & \text{if } p_{\text{series}} > 1
\end{cases}$$

Both modes use the same elasticity $\alpha_c$ and maxStretch $\beta_c$
(defaults 0.3 and 0.5). No per-chart-type overrides are needed — the
different $\sigma$ values account for the fact that a date tick needs
~10px ($\sqrt{100}$) while a series needs ~20px of space.

### Positional ≥ Series constraint

For charts where both axes are continuous (line, area), stretching the
positional axis (X) also reduces visual overlap between series. So the
positional axis should stretch at least as much as the series axis:

$$s_{\text{positional}} = \max(s_{\text{positional}},\ s_{\text{series}})$$

### Why $\beta_c$ should differ from discrete $\beta$

The maximum stretch for continuous axes should be **smaller** than for discrete axes.

**Cognitive basis.** Perceptual research (Cleveland & McGill, 1984; Heer & Bostock, 2010) ranks visual encodings by accuracy:

1. Position along a common scale (most accurate)
2. Length
3. Area
4. Color / density

For **discrete/banded axes**, each item is read by its **position and length** — the band width directly encodes the item's allocation. Compressing bands reduces length accuracy, which degrades rapidly.

For **continuous axes**, items are read by **position along a scale** — the most robust channel. A scatter plot remains readable even when compressed because relative positions are preserved under scaling.

| | Discrete axis | Continuous axis |
|---|---|---|
| Primary encoding | Length / area of band | Position along scale |
| Perceptual robustness | Low — degrades with compression | High — survives compression |
| Recommended $\beta$ | 1.0 (up to 2× stretch) | 0.5 (up to 1.5× stretch) |

## Parameter table

| Chart type   | σ_x | σ_y | α_c | β_c | seriesCountAxis |
|--------------|-----|-----|-----|-----|-----------------|
| Scatter      | 30  | 30  | 0.3 | 0.5 | —               |
| Line         | 100 | 20  | 0.3 | 0.5 | auto (→ Y)      |
| Dotted Line  | 100 | 20  | 0.3 | 0.5 | auto (→ Y)      |
| Area         | 100 | 20  | 0.3 | 0.5 | auto (→ Y)      |
| Streamgraph  | 100 | 20  | 0.3 | 0.5 | auto (→ Y)      |
| Bump         | 80  | 20  | 0.3 | 0.5 | auto (→ Y)      |
| Stacked Bar  | 20  | 20  | 0.3 | 0.5 | auto (→ Y*)     |

\* For stacked bar, X is discrete (spring model), Y is continuous.
`auto` resolves to Y via the 1D path. For horizontal stacked bars,
`auto` would resolve to X.

## Worked examples

### Series-axis stretch (σ = 20, dim₀ = 300 (illustrative), α_c = 0.3, maxStretch = 1.5)

| Scenario              | nSeries | pressure | stretch | Final dim |
|----------------------|---------|----------|---------|-----------|
| 8 series (typical)   | 8       | 0.53     | 1.0     | 300       |
| 15 series (moderate) | 15      | 1.0      | 1.0     | 300       |
| 20 series (busy)     | 20      | 1.33     | 1.09    | 328       |
| 40 series (extreme)  | 40      | 2.67     | 1.35    | 406       |

### Combined positional + series (positional ≥ series constraint)

| Scenario              | nDates | nSeries | raw X | raw Y | final X | final Y |
|----------------------|--------|---------|-------|-------|---------|---------|
| 12 dates × 20 series | 12     | 20      | 1.0   | 1.09  | **1.09**| 1.09    |
| 100 dates × 40 series| 100    | 40      | 1.32  | 1.35  | **1.35**| 1.35    |
| 100 dates × 60 series| 100    | 60      | 1.32  | 1.50  | **1.50**| 1.50    |
| 200 dates × 3 series | 200    | 3       | 1.50  | 1.0   | 1.50    | 1.0     |
| 200 dates × 20 series| 200    | 20      | 1.50  | 1.09  | 1.50    | 1.09    |

When positional pressure already exceeds series (bottom two rows), no adjustment needed.

## §2 Summary

| Symbol | Meaning | Default |
|---|---|---|
| $\sigma$ | 2D mark cross-section (px²) | 30 |
| $\sigma_x, \sigma_y$ | Per-axis cross-sections | chart-type specific |
| $\sigma_{1d}$ | 1D projection: $\sqrt{\sigma}$ | $\sqrt{30} \approx 5.5$ |
| $\alpha_c$ | Elasticity exponent | 0.3 |
| $\beta_c$ | Max stretch − 1 | 0.5 |
| `seriesCountAxis` | Which axis uses series-count pressure | `'auto'` for line/area/stacked bar |

```
Given: data points with x/y values, per-axis cross-sections σ_x σ_y,
       canvas W₀×H₀, elasticity αc, max stretch βc,
       optional seriesCountAxis

For each axis (X, Y):
    if seriesCountAxis resolves to this axis:
        nSeries = |distinct color ∪ detail values|
        pressure = nSeries · σ / dim₀
    else:
        uniquePos = |{ round(v · px_per_unit) : v ∈ data }|
        σ_1d = √σ
        pressure = uniquePos · σ_1d / dim₀

    if pressure ≤ 1:
        stretch = 1
    else:
        stretch = min(1 + βc, pressure^αc)

# Positional ≥ Series constraint (when seriesCountAxis is set):
stretch_positional = max(stretch_positional, stretch_series)

W = W₀ · stretch_x
H = H₀ · stretch_y
```