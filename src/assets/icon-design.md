# Chart Icon Design Guide

Design conventions for chart template icons in `src/assets/`.

## Color Palette

| Token | Hex | Usage |
|-------|-----|-------|
| Blue | `#76c6ff` | Primary data marks (fills, dots) |
| Gray | `#B8B8B8` | Secondary data marks, second series |
| Dark | `#363636` | Axes, stems, outlines |
| Pastel Red | `#e8868f` | Bearish / negative (candlestick) |
| Pastel Green | `#6dc48d` | Bullish / positive (candlestick) |

All colors are muted/pastel to match the overall UI tone. Avoid saturated primaries.

## Format

- **New icons**: SVG (`chart-icon-*.svg`), viewBox `0 0 256 256`
- **Legacy icons**: minified PNG (`chart-icon-*-min.png`)
- Prefer SVG for new additions — scales cleanly at any size

## Structure (SVG)

- Axes drawn last so they layer on top
- Y-axis: `x1="48" y1="28" x2="48" y2="220"`, stroke `#363636`, width 4, round cap
- X-axis: `x1="44" y1="216" x2="240" y2="216"`, stroke `#363636`, width 4, round cap
- Data region: roughly `x ∈ [60, 236]`, `y ∈ [40, 216]`

## Style Rules

1. **Two-color data** — use blue + gray to suggest a color encoding (e.g. lollipop alternates blue/gray dots)
2. **Stems / rules** — use dark (`#363636`), not the fill color
3. **Fills** — use the palette blues/grays; keep opacity implicit via lighter hex, not `opacity` attribute
4. **Strokes on filled areas** — use a slightly darker shade of the fill (e.g. `#4a9edd` outline on `#76c6ff` fill)
5. **Special semantics** (e.g. candlestick bull/bear) — use the pastel red/green pair

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
| `chart-icon-pyramid-min.png` | Pyramid Chart | PNG |
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
