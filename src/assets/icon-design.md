# Chart Icon Design Guide

Design conventions for chart template icons in `src/assets/`.

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| **Light Blue** | `#76c6ff` | Primary fill — dots, bars, areas (series A) |
| **Dark Blue** | `#4a8acb` | Primary stroke / line (series A) |
| **Light Gray** | `#B8B8B8` | Secondary fill — dots, bars, areas (series B) |
| **Dark Gray** | `#7a7a7a` | Secondary stroke / line (series B) |
| **Axis / Outline** | `#363636` | Axes, mark outlines, stems |
| **Pastel Red** | `#e8868f` | Bearish / negative (candlestick) |
| **Pastel Green** | `#6dc48d` | Bullish / positive (candlestick) |

All colors are muted/pastel to match the overall UI tone. Avoid saturated primaries.

## Mark Style Rules

### Filled marks (bars, circles, areas)

- **Fill** with light color (`#76c6ff` or `#B8B8B8`)
- **Outline** with `#363636`, stroke-width `2`–`3`
- This gives marks a clean, defined edge consistent with the designer samples

### Lines (line charts, bump charts)

- **Stroke** with dark color (`#4a8acb` for blue series, `#7a7a7a` for gray series)
- **Stroke-width**: `4`–`5`, `stroke-linecap="round"`, `stroke-linejoin="round"`
- Dots on lines: fill with the corresponding light color, outline `#363636` stroke-width `2`

### Line thickness reference

| Element | stroke-width |
|---------|-------------|
| Axes | `4` |
| Data lines (line/bump/area outline) | `4`–`5` |
| Mark outlines (bars, dots, rects) | `2`–`3` |
| Stems / rules (lollipop) | `4` |
| Grid / spokes (radar) | `0.6`–`0.8` |

### Two-series convention

Charts that show a color encoding use **two series**:
- Series A: light blue fill / dark blue stroke
- Series B: light gray fill / dark gray stroke

For charts needing **four series** (e.g. bump chart), alternate:
- Series 1: `#76c6ff` fill / `#4a8acb` stroke
- Series 2: `#B8B8B8` fill / `#7a7a7a` stroke
- Series 3: `#5ba8e0` fill / `#3d7ebf` stroke
- Series 4: `#d0d0d0` fill / `#a8a8a8` stroke

## Format

- **New icons**: SVG (`chart-icon-*.svg`), viewBox `0 0 256 256`
- **Legacy icons**: minified PNG (`chart-icon-*-min.png`)
- Prefer SVG for new additions — scales cleanly at any size

## Structure (SVG)

- Axes drawn last so they layer on top
- Y-axis: `x1="48" y1="28" x2="48" y2="220"`, stroke `#363636`, width 4, round cap
- X-axis: `x1="44" y1="216" x2="240" y2="216"`, stroke `#363636`, width 4, round cap
- Data region: roughly `x ∈ [60, 236]`, `y ∈ [40, 216]`

## Icon Inventory

| File | Chart Type | Format |
|------|-----------|--------|
| `chart-icon-scatter-min.png` | Scatter Plot | PNG |
| `chart-icon-linear-regression-min.png` | Linear Regression | PNG |
| `chart-icon-dot-plot-horizontal-min.png` | Ranged Dot Plot | PNG |
| `chart-icon-box-plot-min.png` | Boxplot | PNG |
| `chart-icon-bubble-min.png` | Bubble Chart | PNG |
| `chart-icon-column-min.png` | Bar Chart | PNG |
| `chart-icon-column-grouped-min.png` | Grouped Bar Chart | PNG |
| `chart-icon-column-stacked-min.png` | Stacked Bar Chart | PNG |
| `chart-icon-histogram-min.png` | Histogram | PNG |
| `chart-icon-heat-map-min.png` | Heatmap | PNG |
| `chart-icon-pyramid.svg` | Pyramid Chart | SVG |
| `chart-icon-line-min.png` | Line Chart | PNG |
| `chart-icon-dotted-line-min.png` | Dotted Line Chart | PNG |
| `chart-icon-area.svg` | Area Chart | SVG |
| `chart-icon-streamgraph.svg` | Streamgraph | SVG |
| `chart-icon-lollipop.svg` | Lollipop Chart | SVG |
| `chart-icon-density.svg` | Density Plot | SVG |
| `chart-icon-candlestick.svg` | Candlestick Chart | SVG |
| `chart-icon-waterfall.svg` | Waterfall Chart | SVG |
| `chart-icon-strip-plot.svg` | Strip Plot | SVG |
| `chart-icon-radar.svg` | Radar Chart | SVG |
| `chart-icon-bump.svg` | Bump Chart | SVG |
| `chart-icon-pie-min.png` | Pie Chart | PNG |
| `chart-icon-us-map-min.png` | US Map | PNG |
| `chart-icon-world-map-min.png` | World Map | PNG |
| `chart-icon-custom-point-min.png` | Custom Point | PNG |
| `chart-icon-custom-line-min.png` | Custom Line | PNG |
| `chart-icon-custom-bar-min.png` | Custom Bar | PNG |
| `chart-icon-custom-rect-min.png` | Custom Rect | PNG |
| `chart-icon-custom-area-min.png` | Custom Area | PNG |
| `chart-icon-dot-plot-vertical-min.png` | *(unused — was Lollipop)* | PNG |
| `chart-icon-table-min.png` | Table | PNG |
