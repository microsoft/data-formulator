# Chart Engine Test Plan

## Scatter Plot

A scatter plot places marks (points/bubbles) in a 2D space. The core axes are continuous (quantitative), but one or both axes can be discrete (nominal), which changes how the engine computes layout, step sizing, and overflow.

Temporal axes are omitted from scatter tests because T behaves identically to Q in scatter layout — no special handling. Temporal is still tested as a color channel (`color: 'T'`).

Default test canvas: 300 × 300 px.

### Matrix-driven approach

Tests are generated from a **declarative matrix** (`SCATTER_MATRIX` in `scatter-tests.ts`). Each row describes one test via its axis types, optional third channels, cardinality, and special flags. A generator function converts each matrix entry into a full `TestCase`.

### Matrix dimensions

| Dimension | Values | Notes |
|-----------|--------|-------|
| **x axis type** | Q, N | Quantitative, Nominal |
| **y axis type** | Q, N | Same |
| **color channel** | —, Q, T, N | Optional 3rd encoding |
| **size channel** | —, Q, N | Optional 4th encoding |
| **n (density)** | 10–500 | Or 0 for N×N grid mode |
| **cardinality** | xCard, yCard, colorCard, sizeCard | Cardinality of nominal dims |
| **flags** | hugeRange | Special data distributions |

### Full test matrix (25 tests)

#### Q × Q — 15 tests

| # | color | size | n | flags | what it tests |
|---|-------|------|---|-------|---------------|
| 1 | — | — | 20 | | Baseline scatter |
| 2 | N(3) | — | 20 | | Nominal color groups |
| 3 | Q | — | 20 | | Continuous color gradient |
| 4 | T | — | 30 | | Temporal color gradient |
| 5 | — | Q | 50 | | Bubble chart |
| 6 | — | N(4) | 20 | | Ordinal size — 4 ranked levels |
| 7 | N(3) | Q | 15 | | Gapminder-style |
| 8 | Q | Q | 30 | | Dual continuous (4D) |
| 9 | N(20) | Q | 20 | hugeRange | Size 1K–1B, sqrt scale |
| 10 | — | — | 100 | | Moderate density |
| 11 | — | — | 500 | | High density |
| 12 | N(20) | — | 200 | | Dense, many groups |
| 13 | N(50) | — | 100 | | Legend overflow |
| 14 | — | Q | 10 | | Sparse bubbles |
| 15 | — | Q | 200 | | Dense bubbles |

#### N × Q — 4 tests

| # | xCard | color | size | n | what it tests |
|---|-------|-------|------|---|---------------|
| 1 | 5 | Q | — | 25 | Strip + continuous color |
| 2 | 5 | — | Q | 25 | Bubble strip |
| 3 | 2 | — | — | 30 | Binary category strip (edge) |
| 4 | 60 | — | — | 60 | 60 cats — overflow |

#### Q × N — 3 tests (mirrors N×Q with flipped orientation)

| # | yCard | color | size | n | what it tests |
|---|-------|-------|------|---|---------------|
| 1 | 5 | Q | — | 25 | Horizontal strip + continuous color |
| 2 | 5 | — | Q | 25 | Horizontal bubble strip |
| 3 | 60 | — | — | 60 | Horizontal 60-cat overflow |

#### N × N — 3 tests

| # | xCard | yCard | color | size | what it tests |
|---|-------|-------|-------|------|---------------|
| 1 | 5 | 6 | — | Q | Bubble grid |
| 2 | 5 | 4 | Q | — | Heatmap-like grid |
| 3 | 15 | 12 | — | Q | Large grid — overflow |

### Coverage summary

Axis combos: Q×Q, N×Q, Q×N, N×N. Third-channel variants (color and size, typed Q/T/N) crossed with Q×Q. Density from 10 to 500. Edge cases: binary categories, legend overflow, huge value ranges.

### How to add a test

Add one row to `SCATTER_MATRIX` in `scatter-tests.ts`:

```typescript
{ x: 'N', y: 'Q', n: 40, xCard: 8, color: 'Q', desc: 'Strip + continuous color, moderate density' },
```

The generator handles field naming, data synthesis, metadata, tags, and title automatically.

---

## Line Chart

A line chart connects data points with lines. Lines imply sequential progression, so axes use T (temporal), O (ordinal), or Q (quantitative) — never purely nominal. N (nominal) is used only for color groups.

Channels: `x, y, color, opacity, column, row`

### Matrix-driven approach

Tests are generated from `LINE_MATRIX` in `line-tests.ts`. Each row specifies axis types, optional color channel, point count, and flags like `sparse` (20% dropout).

### Full test matrix (18 tests)

#### T × Q — 6 tests (core time series)

| # | color | n | flags | what it tests |
|---|-------|---|-------|---------------|
| 1 | — | 30 | | Simple time series |
| 2 | N(4) | 200 | | 4 series × 50 dates |
| 3 | N(8) | 800 | | 8 series crowded |
| 4 | N(20) | 4000 | stress | 20 series spaghetti |
| 5 | N(3) | 180 | sparse | 3 series, ~20% missing |
| 6 | Q | 30 | | Continuous color gradient |

#### O × Q — 4 tests (ordinal x)

| # | xCard | color | n | what it tests |
|---|-------|-------|---|---------------|
| 7 | 5 | — | 5 | Ordinal line |
| 8 | 12 | N(4) | 48 | 12 ordinal × 4 series |
| 9 | 30 | — | 30 | Label overflow |
| 10 | 5 | Q | 5 | Ordinal + gradient |

#### Q × O — 3 tests (mirror)

| # | yCard | color | n | what it tests |
|---|-------|-------|---|---------------|
| 11 | 5 | — | 5 | Horizontal ordinal |
| 12 | 12 | N(4) | 48 | Horizontal 12 ordinal × 4 |
| 13 | 30 | — | 30 | Horizontal 30 ordinal overflow |

#### Q × Q — 3 tests

| # | color | n | what it tests |
|---|-------|---|---------------|
| 14 | — | 30 | Quantitative x line |
| 15 | N(3) | 150 | 3 parametric curves |
| 16 | — | 200 | Dense single curve |

#### Excluded combos

- **T×T, Q×T** — date-pair data (start vs end date) doesn't suit line charts. Each row is an independent event, not a sequential series; lines connect points in data order producing random zig-zags. Better served by scatter or dumbbell charts.
- **O×O** — ordinal×ordinal lines are degenerate.
- **N×N, T×N, N×T** — purely nominal axes don't suit line charts. Lines imply sequence/progression; connecting unordered categories is misleading.

### Coverage summary

Axis combos: T×Q, O×Q, Q×O, Q×Q. Color variants (N, Q) crossed with primary combos. Density from 5 to 4000 (stress). Sparse dropout tests irregular gaps. Total **18 tests**.

---

## Bar Chart / Stacked Bar Chart / Grouped Bar Chart

Bar charts encode values as rectangular bars. Three variants share a common matrix format in `bar-tests.ts`:
- **Bar Chart**: `x, y, color, opacity` — basic bars with optional color
- **Stacked Bar Chart**: `x, y, color` — bars stacked by color dimension
- **Grouped Bar Chart**: `x, y, group` — bars side-by-side by group dimension

### Matrix-driven approach

Three matrices (`BAR_MATRIX`, `STACKED_BAR_MATRIX`, `GROUPED_BAR_MATRIX`) share one generator function `barMatrixToTestCase`. The third channel key is `'color'` for bar/stacked and `'group'` for grouped.

### Bar Chart matrix (20 tests)

#### N × Q — 6 tests (classic vertical)

| # | xCard | color | n | what it tests |
|---|-------|-------|---|---------------|
| 1 | 5 | — | 5 | Basic 5 bars |
| 2 | 20 | — | 20 | Label rotation |
| 3 | 30 | — | 30 | Thin bar handling |
| 4 | 100 | — | 100 | Discrete cutoff |
| 5 | 5 | N(3) | 15 | 5 cats × 3 colors |
| 6 | 5 | N(20) | 100 | Color saturation |

#### Q × N — 3 tests (horizontal)

| # | yCard | color | n | what it tests |
|---|-------|-------|---|---------------|
| 7 | 10 | — | 10 | Horizontal 10 bars |
| 8 | 100 | — | 100 | Horizontal cutoff |
| 9 | 10 | N(3) | 30 | Horizontal + 3 colors |

#### T × Q — 3 tests (temporal)

| # | color | n | what it tests |
|---|-------|---|---------------|
| 10 | — | 24 | Temporal bars |
| 11 | — | 100 | 100 dates — dynamic sizing |
| 12 | N(3) | 72 | Temporal + 3 colors |

#### Q × T — 2 tests (horizontal temporal)

| # | color | n | what it tests |
|---|-------|---|---------------|
| 13 | — | 18 | Horizontal temporal |
| 14 | N(3) | 54 | Horizontal temporal + color |

#### Q × Q — 2 tests (continuous banded)

| # | n | what it tests |
|---|---|---------------|
| 15 | 20 | Both quant — dynamic resizing |
| 16 | 30 | Equally spaced 1..30 |

#### Edge combos — 4 tests

| # | x | y | n | what it tests |
|---|---|---|---|---------------|
| 17 | N | N | grid | Cat × cat (degenerate) |
| 18 | T | T | 20 | Date × date (degenerate) |
| 19 | T | N | 25 | Temporal × categorical |
| 20 | N | T | 25 | Categorical × temporal |

### Stacked Bar Chart matrix (13 tests)

| # | x | y | color | n | what it tests |
|---|---|---|-------|---|---------------|
| 1 | N | Q | N(3) | 12 | Basic stack 4×3 |
| 2 | N | Q | N(5) | 75 | Large 15×5 |
| 3 | N | Q | N(3) | 240 | Very large 80×3 (cutoff) |
| 4 | N | Q | Q(4) | 24 | Numeric color (1–4) |
| 5 | N | Q | Q(30) | 150 | Numeric color (1–30) |
| 6 | T | Q | N(3) | 30 | Temporal stack |
| 7 | T | Q | N(4) | 80 | 20 dates × 4 |
| 8 | Q | Q | N(3) | 30 | Both quant stacked |
| 9 | Q | N | N(3) | 24 | Horizontal stack |
| 10 | Q | T | N(3) | 45 | Horizontal temporal stack |
| 11 | N | N | N(3) | grid | Cat×cat stacked (edge) |
| 12 | T | T | N(3) | 30 | Date×date stacked (edge) |
| 13 | T | N | N(4) | 20 | Temporal×cat stacked |

### Grouped Bar Chart matrix (13 tests)

| # | x | y | group | n | what it tests |
|---|---|---|-------|---|---------------|
| 1 | N | Q | N(3) | 12 | Basic grouped 4×3 |
| 2 | N | Q | — | 8 | No group — fallback |
| 3 | N | Q | N(3) | 270 | Very large 90×3 (cutoff) |
| 4 | N | Q | Q(5) | 30 | Numeric group (1–5) |
| 5 | T | Q | N(3) | 36 | Temporal grouped |
| 6 | Q | Q | N(4) | 20 | Both quant + group |
| 7 | Q | N | N(4) | 24 | Horizontal grouped |
| 8 | Q | T | N(3) | 30 | Horizontal temporal grouped |
| 9 | N | Q | Q(50) | 400 | Numeric group (1–50) |
| 10 | N | Q | Q | 50 | Continuous float on group |
| 11 | N | N | N(3) | grid | Cat×cat grouped (edge) |
| 12 | T | T | N(3) | 30 | Date×date grouped (edge) |
| 13 | T | N | N(4) | 20 | Temporal×cat grouped |

### Coverage summary

All three bar variants cover all 9 xy-type combinations. Bar Chart has 20 tests, Stacked Bar has 13, Grouped Bar has 13 — total **46 bar tests**. Covers horizontal/vertical orientation, discrete cutoff, numeric/continuous color, edge combos.

## Area Chart & Streamgraph

**File:** `area-tests.ts`
**Approach:** Matrix-driven — `AREA_MATRIX` (23 entries) + `STREAMGRAPH_MATRIX` (6 entries).
**Shared generator:** `areaMatrixToTestCase(entry, chartType, rand)` — same infrastructure for both chart types.
**Data characteristic:** Uses `genAreaTrend()` with upward drift (natural for cumulative / stacked-area metrics).

Area charts use O (ordinal) for categorical axes (like line charts) — area fills imply continuity. N (nominal) is used only for color groups. Purely nominal axis combos are excluded.

### Area Chart matrix (18 tests)

#### T × Q — 7 tests (core stacked / layered area)

| # | color | n | flags | what it tests |
|---|-------|---|-------|---------------|
| 1 | — | 30 | | Simple time-series area |
| 2 | N(4) | 96 | | 4 stacked series |
| 3 | N(8) | 480 | | 8 series large stacked |
| 4 | N(15) | 1800 | stress | 15 series stress |
| 5 | N(3) | 120 | | 3 layered/overlapping |
| 6 | N(3) | 180 | sparse | 3 series, ~20% missing |
| 7 | Q | 30 | | Continuous color gradient |

#### O × Q — 4 tests (ordinal x)

| # | xCard | color | n | what it tests |
|---|-------|-------|---|---------------|
| 8 | 5 | — | 5 | Ordinal area 5 cats |
| 9 | 12 | N(4) | 48 | 12 ordinal × 4 stacked |
| 10 | 30 | — | 30 | 30 ordinal overflow |
| 11 | 5 | Q | 5 | Ordinal + continuous color |

#### Q × O — 3 tests (mirror)

| # | yCard | color | n | what it tests |
|---|-------|-------|---|---------------|
| 12 | 5 | — | 5 | Horizontal ordinal 5 cats |
| 13 | 12 | N(4) | 48 | Horizontal 12 ordinal × 4 |
| 14 | 30 | — | 30 | Horizontal 30 ordinal overflow |

#### Q × Q — 3 tests

| # | color | n | what it tests |
|---|-------|---|---------------|
| 15 | — | 30 | Quantitative x area |
| 16 | N(3) | 150 | 3 stacked curves |
| 17 | — | 200 | Dense single-series |

#### Excluded combos

- **T×T, Q×T** — date-pair data doesn't suit area charts. Area fills imply sequential progression; T×T/Q×T lack monotonic relationships.
- **N×N, T×N, N×T** — purely nominal axes don't suit area charts. Area fills imply continuity/progression; nominal axes lack this.

### Streamgraph matrix (6 tests)

| # | x | y | color | n | what it tests |
|---|---|---|-------|---|---------------|
| 1 | T | Q | N(5) | 200 | 5 genres basic streamgraph |
| 2 | T | Q | N(10) | 800 | 10 industries large |
| 3 | T | Q | N(20) | 3000 | 20 series stress |
| 4 | T | Q | N(5) | 200 | 5 series ~20% sparse |
| 5 | O | Q | N(5) | 60 | Ordinal streamgraph |
| 6 | Q | Q | N(3) | 150 | Quant-x streamgraph |

### Coverage summary

Area Chart covers T×Q, O×Q, Q×O, Q×Q axis combos (18 tests). Streamgraph adds 6 tests exercising T×Q, O×Q, and Q×Q with multi-series color. Total **24 area/streamgraph tests**.

---

## Grand total

| Chart type | Tests |
|------------|-------|
| Scatter | 25 |
| Line | 18 |
| Bar | 20 |
| Stacked Bar | 13 |
| Grouped Bar | 13 |
| Area | 18 |
| Streamgraph | 6 |
| **Total** | **113** |
