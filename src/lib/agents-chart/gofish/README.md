# GoFish Backend

Compiles the core semantic layer into [GoFish Graphics](https://www.npmjs.com/package/gofish-graphics) (v0.0.22) render calls. Unlike the other three backends which produce serializable JSON specs, GoFish renders directly to the DOM via Solid.js using a fluent API.

## Output Format

```typescript
{
  _gofish: { type, data, flow, mark, layers?, coord? },  // descriptor
  render: (container: HTMLElement) => void,                // imperative render function
  _width: number,
  _height: number,
  _specDescription: string,  // human-readable debug string
}
```

A `GoFishSpec` object. The `render` function dynamically imports `gofish-graphics` at call time and executes the fluent API chain: `chart(data).flow(...).mark(...).render(el, opts)`.

## Assembly Pipeline

| Phase | Step | Description |
|-------|------|-------------|
| **0** | `resolveSemantics` | Shared — resolve field types, aggregates, sort orders |
| 0a | `declareLayoutMode` | Template layout declaration |
| 0b | `convertTemporalData` | Shared — temporal parsing |
| 0c | `filterOverflow` | Shared — category truncation |
| **1** | `computeLayout` | Shared — step sizes, subplot dimensions |
| **2** | Build `resolvedEncodings` → `template.instantiate` → optional `postProcess` → compute dimensions → wrap in `GoFishSpec` with `buildRenderFunction` | `GoFishSpec` |

**Key differences from other backends:**
- No `instantiate-spec.ts` — GoFish templates write the `_gofish` descriptor directly; the assembler wraps it in a render closure.
- Has a `postProcess` template hook not present in other backends.
- `buildRenderFunction` translates the JSON-like descriptor into live GoFish API calls at render time.

## File Structure

```
gofish/
  assemble.ts    – assembleGoFish(), buildRenderFunction(), buildFlowOp(), buildMark()
  index.ts       – barrel exports
  templates/
    index.ts     – template registry (8 templates, 4 categories)
    scatter.ts   – Scatter Plot (with optional data-driven color via rect)
    bar.ts       – Bar, Grouped Bar, Stacked Bar
    line.ts      – Line Chart (single + multi-series via layers)
    area.ts      – Area Chart (single + stacked via layers)
    pie.ts       – Pie Chart (clock() coordinate)
    scatterpie.ts – Scatter Pie (scatter-positioned mini pies)
    utils.ts     – detectAxes(), extractCategories(), aggregateByCategory(), groupBy()
```

## Template Definitions (8 templates)

| Category | Charts |
|----------|--------|
| Scatter & Point | Scatter Plot |
| Bar | Bar Chart, Grouped Bar, Stacked Bar |
| Line & Area | Line Chart, Area Chart |
| Part-to-Whole | Pie Chart, Scatter Pie Chart |

## GoFish API Patterns

### Flow Operators
| Operator | Usage | Description |
|----------|-------|-------------|
| `spread(field, opts)` | Categorical axis | Distributes items along an axis by category |
| `stack(field, opts)` | Stacking | Stacks items by category; `dir: "x"` or `"y"` |
| `scatter(key, {x, y})` | Positional | Places items at (x, y) positions keyed by unique ID |
| `group(field)` | Grouping | Groups data for multi-series marks (line, area) |

### Marks
| Mark | Usage | Notes |
|------|-------|-------|
| `rect({h, w, fill})` | Bar, pie slices | Data-driven fill via field name |
| `circle({r, fill})` | Scatter (no color) | `fill` accepts literal CSS colors only, NOT field names |
| `scaffold({h, fill}).name("label")` | Line/area anchor | Creates invisible positioned points; `.name()` only works on configured marks (not bare `scaffold()`) |
| `line()` / `area({opacity})` | Connect points | Applied after `scaffold` + `select` or `group` |

### Coordinate Transforms
| Transform | Usage |
|-----------|-------|
| `clock()` | Polar coordinates for pie/rose charts. Passed to `chart(data, { coord: clock() })` |

### Rendering Paths in `buildRenderFunction`

1. **Layered charts** (multi-series line/area): Uses named marks + `gf.layer()` + `gf.select()` for cross-layer references.
2. **Simple charts** (bar, scatter, single-series line/area, pie): Direct `chart(data).flow().mark().render()`.
3. **Scatterpie**: Mark is a function `(data) => chart(data[0].collection, {coord: clock()}).flow(stack).mark(rect)`.

### Dimension Calculation
- **Layered charts**: Use `subplotWidth`/`subplotHeight` from layout directly (gas-pressure continuous sizing).
- **Non-layered discrete-axis charts**: Use `step × count` from layout.
- **Padding**: 80px added to both width and height for axes/labels.

## Known Issues & Notes

- **ESM-only**: `gofish-graphics` is an ESM-only package. Loaded via dynamic `import()` inside `buildRenderFunction` to avoid bundling issues with CommonJS consumers.
- **Solid.js dependency**: GoFish renders to DOM via Solid.js — it does not produce a serializable spec. The `_gofish` descriptor is for debugging only.
- **`scaffold()` bare vs configured**: `scaffold()` with no arguments returns a bare function whose `.name` is `Function.name` (a string, not callable). Always pass options: `scaffold({h: field}).name("label")`.
- **`circle({fill})` limitation**: GoFish's `circle` mark only accepts literal CSS color strings for `fill`, not data field names. For data-driven scatter color, the template uses `rect({w:8, h:8, fill: field})` as small colored squares instead.
- **No faceting support**: GoFish has no faceting mechanism. Column/row channels are accepted in template definitions but not implemented.
- **Multi-series line/area**: Uses `scaffold({h, fill}).name("pts")` + `group(colorField)` + `line()`/`area()`. The assembler tries `mark.name(label)` first, falls back to `spec.as(label)`.
- **Pie chart**: Uses `chart(data, { coord: clock() })` + `stack(catField, { dir: "x" })` + `rect({ w: valField, fill: catField })`. The `transform: { x: w/2, y: h/2 }` render option centers the chart.
- **Scatter Pie**: Unique to GoFish — scatter-positioned mini pies. The template restructures flat data into `{_key, _x, _y, collection: [...]}` and the mark is a function returning a sub-chart.
- **`--legacy-peer-deps`**: Required when installing `gofish-graphics` due to Solid.js peer dependency conflicts.
