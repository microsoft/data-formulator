# ECharts Backend

Compiles the core semantic layer into [Apache ECharts](https://echarts.apache.org/) option objects. Uses a series-based data model rather than VL's encoding-channel approach.

## Output Format

```jsonc
{ "xAxis": {...}, "yAxis": {...}, "series": [{ "type": "bar", "data": [...] }], "tooltip": {...}, "legend": {...}, "grid": {...} }
```

An ECharts option object with `_width`/`_height` hints and optional `_warnings`. Consumed by `echarts.init(dom).setOption(spec)`.

## Assembly Pipeline

| Phase | Step | Description |
|-------|------|-------------|
| **0** | `resolveSemantics` | Shared — resolve field types, aggregates, sort orders |
| 0a | `declareLayoutMode` | Template layout declaration |
| 0b | `convertTemporalData` | Shared — temporal parsing |
| 0c | `filterOverflow` | Shared — category truncation |
| **1** | `computeLayout` | Shared — step sizes, subplot dimensions |
| **2** | Build `resolvedEncodings` → `template.instantiate` → `ecApplyLayoutToSpec` → `ecCombineFacetPanels` → tooltips | Final ECharts option |

**Key difference from VL:** No `buildVLEncodings` step. ECharts templates read `channelSemantics` directly and produce series/axis config themselves.

## File Structure

```
echarts/
  assemble.ts          – assembleECharts(): Phase 2 assembly
  instantiate-spec.ts  – ecApplyLayoutToSpec(), ecApplyTooltips()
  facet.ts             – ecCombineFacetPanels(): synthetic multi-grid faceting
  index.ts             – barrel exports
  templates/
    index.ts           – template registry (13 templates, 6 categories)
    scatter.ts         – Scatter Plot
    bar.ts             – Bar, Grouped Bar, Stacked Bar
    line.ts            – Line Chart
    area.ts            – Area, Streamgraph
    pie.ts             – Pie Chart
    histogram.ts       – Histogram
    heatmap.ts         – Heatmap
    boxplot.ts         – Boxplot
    candlestick.ts     – Candlestick Chart
    radar.ts           – Radar Chart
    rose.ts            – Rose Chart
    streamgraph.ts     – Streamgraph (themeRiver)
    utils.ts           – shared utilities
```

## Template Definitions (13 templates)

| Category | Charts |
|----------|--------|
| Scatter & Point | Scatter Plot, Boxplot |
| Bar | Bar Chart, Grouped Bar, Stacked Bar, Histogram, Heatmap |
| Line & Area | Line Chart, Area Chart, Streamgraph |
| Part-to-Whole | Pie Chart |
| Financial | Candlestick Chart |
| Polar | Radar Chart, Rose Chart |

## Known Issues & Notes

- **Custom faceting module** (`facet.ts`, 252 lines): ECharts has no native faceting, so this module synthesizes multi-grid layouts with `grid[]`, `xAxis[]`, `yAxis[]`, `series[]` (indexed), and `graphic[]` for header labels. Only axis-based charts support faceting — pie, radar, and themeRiver do not.
- Bar sizing uses explicit `barWidth`, `barCategoryGap`, `barGap` pixel values rather than VL's declarative `step` sizing.
- Zero-baseline uses `axis.min` / `scale: true` instead of VL's `scale.zero`.
- Axis-less charts (pie, radar) are detected separately in `instantiate-spec.ts` — they skip axis/grid config entirely.
- ECharts Streamgraph uses `themeRiver` series type, which has different data shape requirements.
- The `ecCombineFacetPanels` step is unique to ECharts — it converts separate facet panel specs into a single multi-grid option.
