# Vega-Lite Backend

The primary and most feature-complete backend for agents-chart. Compiles the core semantic layer into declarative [Vega-Lite](https://vega.github.io/vega-lite/) JSON specifications.

## Output Format

```jsonc
{ "mark": "bar", "encoding": { "x": { "field": "Name", "type": "nominal" }, ... }, "data": { "values": [...] }, "width": 400, "height": 300 }
```

A declarative JSON spec consumed by the Vega-Lite renderer. Bar sizing uses `width: { step: N }`, axis/legend/tooltip configuration is fully declarative via encodings and config blocks, and faceting uses VL's native `facet` + `columns` structure.

## Assembly Pipeline

All backends share Phases 0 and 1 from `core/`. Phase 2 is VL-specific.

| Phase | Step | Description |
|-------|------|-------------|
| **0** | `resolveSemantics` | Resolve field types, aggregates, ordinal sort orders |
| 0a | `declareLayoutMode` | Template declares banded axes, sizing hints, auto-detect binned axes |
| 0b | `convertTemporalData` | Parse temporal strings to JS Dates |
| 0c | `filterOverflow` | Truncate categories that overflow the canvas |
| **1** | `computeLayout` | Compute step sizes, subplot dimensions, tick params (target-agnostic) |
| **2** | `buildVLEncodings` → `template.instantiate` → `restructureFacets` → `vlApplyLayoutToSpec` → post-layout (facet binning, independent scales, tooltips) | Final VL spec |

**Unique to VL:** The `buildVLEncodings` step translates abstract `ChannelSemantics` into VL encoding objects before templates run — other backends skip this and let templates read `channelSemantics` directly.

## File Structure

```
vegalite/
  assemble.ts          – assembleVegaLite(): Phase 2 assembly
  instantiate-spec.ts  – vlApplyLayoutToSpec(), vlApplyTooltips()
  index.ts             – barrel exports
  templates/
    index.ts           – template registry (27 templates, 7 categories)
    scatter.ts         – Scatter Plot, Linear Regression
    bar.ts             – Bar, Grouped Bar, Stacked Bar, Histogram, Lollipop, Pyramid
    line.ts            – Line, Dotted Line, Bump Chart
    area.ts            – Area, Streamgraph
    pie.ts             – Pie Chart
    rose.ts            – Rose Chart
    radar.ts           – Radar Chart
    density.ts         – Density Plot
    candlestick.ts     – Candlestick Chart
    waterfall.ts       – Waterfall Chart
    lollipop.ts        – Lollipop (also in bar.ts registry)
    jitter.ts          – Strip Plot
    bump.ts            – Bump Chart helpers
    custom.ts          – Custom Point/Line/Bar/Rect/Area
    map.ts             – US Map, World Map
    utils.ts           – shared template utilities
```

## Template Definitions (27 templates)

| Category | Charts |
|----------|--------|
| Scatter & Point | Scatter Plot, Linear Regression, Boxplot, Strip Plot |
| Bar | Bar Chart, Grouped Bar, Stacked Bar, Histogram, Lollipop, Pyramid |
| Line & Area | Line Chart, Dotted Line, Bump Chart, Area Chart, Streamgraph |
| Part-to-Whole | Pie Chart, Rose Chart, Heatmap, Waterfall Chart |
| Statistical | Density Plot, Ranged Dot Plot, Radar Chart, Candlestick Chart |
| Map | US Map, World Map |
| Custom | Custom Point, Custom Line, Custom Bar, Custom Rect, Custom Area |

## Known Issues & Notes

- **Richest template set** of all backends (27 templates). Maps and statistical charts (density, candlestick, waterfall) are only available in VL.
- `instantiate-spec.ts` (421 lines) is the only file that contains Vega-Lite syntax knowledge — all other files work with abstract semantics.
- Faceting is handled via VL's native `facet` mechanism; `restructureFacets` converts column-only facets to the `facet` + `columns` structure.
- The `buildVLEncodings` step is an extra translation layer not present in other backends — it converts `ChannelSemantics` to `{ field, type, scale, axis, ... }` encoding objects before template instantiation.
- VL natively handles zero-baseline via `scale: { zero: true }`, bar step sizing via `width: { step }`, and legend positioning — no manual pixel math needed.
