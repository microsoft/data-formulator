# Chart.js Backend

The simplest backend. Compiles the core semantic layer into [Chart.js](https://www.chartjs.org/) configuration objects using a dataset-based data model.

## Output Format

```jsonc
{ "type": "bar", "data": { "labels": ["A","B","C"], "datasets": [{ "data": [10,20,30], "backgroundColor": "..." }] }, "options": { "scales": {...}, "plugins": {...} } }
```

A Chart.js config object with `_width`/`_height` hints. Rendered via `new Chart(canvas, config)` with `responsive: false` and explicit canvas dimensions.

## Assembly Pipeline

| Phase | Step | Description |
|-------|------|-------------|
| **0** | `resolveSemantics` | Shared — resolve field types, aggregates, sort orders |
| 0a | `declareLayoutMode` | Template layout declaration |
| 0b | `convertTemporalData` | Shared — temporal parsing |
| 0c | `filterOverflow` | Shared — category truncation |
| **1** | `computeLayout` | Shared — step sizes, subplot dimensions |
| **2** | Build `resolvedEncodings` → `template.instantiate` → `cjsApplyLayoutToSpec` → tooltips | Final CJS config |

## File Structure

```
chartjs/
  assemble.ts          – assembleChartjs(): Phase 2 assembly
  instantiate-spec.ts  – cjsApplyLayoutToSpec(), cjsApplyTooltips()
  index.ts             – barrel exports
  templates/
    index.ts           – template registry (10 templates, 5 categories)
    scatter.ts         – Scatter Plot
    bar.ts             – Bar, Grouped Bar, Stacked Bar
    line.ts            – Line Chart
    area.ts            – Area Chart
    pie.ts             – Pie Chart
    histogram.ts       – Histogram
    radar.ts           – Radar Chart
    rose.ts            – Rose Chart (polar bar)
    utils.ts           – shared utilities
```

## Template Definitions (10 templates)

| Category | Charts |
|----------|--------|
| Scatter & Point | Scatter Plot |
| Bar | Bar Chart, Grouped Bar, Stacked Bar, Histogram |
| Line & Area | Line Chart, Area Chart |
| Part-to-Whole | Pie Chart |
| Polar | Radar Chart, Rose Chart |

## Known Issues & Notes

- **Smallest backend** — 10 templates, no faceting support, no maps, no custom marks, no statistical charts.
- `instantiate-spec.ts` is only 159 lines — the simplest Phase 2 of all backends.
- Bar sizing uses `barPercentage` / `categoryPercentage` rather than VL's `step` or ECharts' `barWidth`.
- Label rotation uses `ticks.maxRotation` on scales.
- Stacking is configured via `stacked: true` on both x and y scales.
- Axis-less detection checks for `config.type === 'radar'` as well as `pie`/`doughnut`.
- No faceting support — Chart.js has no built-in multi-panel mechanism and no custom faceting module has been implemented.
- Rose Chart is implemented as a polar bar chart (`type: 'polarArea'` or `type: 'bar'` with `indexAxis` and polar scales).
