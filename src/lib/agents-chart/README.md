# agents-chart

A semantic-level visualization library that compiles to Vega-Lite.
The LLM outputs only chart type, field assignments, and a **semantic type**
per field (e.g. `Revenue`, `Rank`, `CategoryCode`). A deterministic compiler
derives all low-level parameters — sizing, zero-baseline, formatting, color
schemes, and mark templates — so charts look good *and* stay editable
without calling the LLM again.

Pure TypeScript · No UI framework dependencies · Data-in, spec-out

> For full motivation & comparisons, see [docs/story.md](docs/story.md).
> For architecture details, see [docs/design_v3.md](docs/design_v3.md).

---

## Why

LLM-generated Vega-Lite faces a dilemma:

| Approach | Looks good | Editable | Bespoke charts | Cost per edit |
|----------|:---:|:---:|:---:|:---:|
| VL defaults | ✗ | ✓ | ✗ | 0 |
| LLM-tuned VL | ✓ | ✗ | Sometimes | 1 LLM call |
| **agents-chart** | **✓** | **✓** | **✓** | **0** |

**Simple specs** are editable but look bad (wrong sizing, misleading
encodings). **Polished specs** look great but are brittle (hard-coded
values break on every field swap). agents-chart resolves this by operating
at a higher semantic level above VL.

### Key insight: semantic types as the contract

Instead of asking the LLM to set dozens of low-level VL parameters, we ask
it one thing: **what does this data mean?** — expressed as a semantic type.

```
Semantic type (e.g. "Revenue")
    ├── Encoding type:   quantitative
    ├── Zero baseline:   true
    ├── Domain padding:  0%
    ├── Scale direction: normal
    ├── Axis formatting: "$,.0f"
    ├── Color scheme:    sequential
    └── Sizing model:    per-axis stretch
```

When the user swaps a field, the compiler re-derives everything from the new
semantic type. No hard-coded constants go stale. No LLM call needed.

### The workflow

```
1. LLM generates:   chart type + semantic types   (~10-line JSON)
2. User edits:      swap field / change mark / add facet → compiler handles it (no AI)
3. Fine-tune (2%):  edit the generated VL directly for bespoke styling
```

---

## Quick start

```ts
import { assembleChart } from './lib/agents-chart';

// Unified single-object interface
const spec = assembleChart({
  data: { values: myData },
  semantic_types: { weight: 'Quantity', mpg: 'Quantity', origin: 'Country' },
  chart_spec: {
    chartType: 'Scatter Plot',
    encodings: { x: { field: 'weight' }, y: { field: 'mpg' }, color: { field: 'origin' } },
    canvasSize: { width: 400, height: 300 },
  },
});

// ECharts backend
import { ecAssembleChart } from './lib/agents-chart';
const option = ecAssembleChart({
  data: { values: myData },
  semantic_types: { weight: 'Quantity', mpg: 'Quantity' },
  chart_spec: {
    chartType: 'Scatter Plot',
    encodings: { x: { field: 'weight' }, y: { field: 'mpg' } },
  },
});

// Chart.js backend
import { cjsAssembleChart } from './lib/agents-chart';
const config = cjsAssembleChart({
  data: { values: myData },
  semantic_types: { weight: 'Quantity' },
  chart_spec: { chartType: 'Bar Chart', encodings: { x: { field: 'category' }, y: { field: 'value' } } },
});
```

---

## Architecture

```
index.ts                ← public API (re-exports core/ + vegalite/)

core/                   ← target-language-agnostic
  types.ts              ← shared type definitions
  semantic-types.ts     ← ~70 semantic types + VisCategory helpers
  decisions.ts          ← pure decision functions (layout, encoding type)
  resolve-semantics.ts  ← Phase 0: semantic resolution (VL-free)
  compute-layout.ts     ← Phase 1: layout computation (VL-free)
  filter-overflow.ts    ← overflow filtering (VL-free)

vegalite/               ← Vega-Lite backend
  assemble.ts           ← assembleChart() orchestrator
  instantiate-spec.ts   ← Phase 2: VL spec instantiation
  templates/            ← chart templates (bar, scatter, bump, …)
```

### Type resolution pipeline

```
  semantic type → getVisCategory() → VisCategory → channel/chart rules → VL encoding type
                                      ↑
            (fallback: inferVisCategory() inspects raw data)
```

---

## Public API

### `assembleChart(input: ChartAssemblyInput)`

All three backends (`assembleChart`, `ecAssembleChart`, `cjsAssembleChart`) accept a single `ChartAssemblyInput` object:

```ts
interface ChartAssemblyInput {
  data: { values: any[] } | { url: string };  // inline rows or URL
  semantic_types?: Record<string, string>;     // field → semantic type
  chart_spec: {
    chartType: string;                         // e.g. "Scatter Plot"
    encodings: Record<string, ChartEncoding>;  // channel → encoding map
    canvasSize?: { width: number; height: number }; // default 400×320
    chartProperties?: Record<string, any>;     // template-specific knobs
  };
  options?: AssembleOptions;                   // layout tuning
}
```

| Key | Description |
|---|---|
| `data` | Data source — either `{ values: [...] }` (inline row objects) or `{ url: "..." }` (JSON/CSV URL) |
| `semantic_types` | Per-column semantic annotations (e.g., `{ revenue: "Price", country: "Country" }`) |
| `chart_spec` | What to draw — chart type, encodings, canvas size, properties |
| `options` | Layout tuning (elasticity, step sizes, tooltips, etc.) |

> **Legacy positional API** (`assembleChart(chartType, encodings, data, ...)`) is still supported but deprecated.

### Key types

```ts
interface ChartEncoding {
  field?: string;
  type?: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
  aggregate?: 'count' | 'sum' | 'average';
  sortOrder?: 'ascending' | 'descending';
  sortBy?: string;
  scheme?: string;
}

interface AssembleOptions {
  addTooltips?: boolean;       // default false
  elasticity?: number;         // axis stretch exponent    (default 0.5)
  maxStretch?: number;         // axis stretch cap         (default 2)
  facetElasticity?: number;    // facet stretch exponent   (default 0.3)
  facetMaxStretch?: number;    // facet stretch cap        (default 1.5)
  minStep?: number;            // min px per discrete tick (default 6)
  minSubplotSize?: number;     // min facet subplot px     (default 60)
}
```

### Template system

Declarative templates for 20+ chart types — basic (bar, line, scatter) and
bespoke (bump chart, candlestick, streamgraph, waterfall, ridge plot).

```ts
chartTemplateDefs      // Map<string, ChartTemplateDef>
getTemplateDef(name)   // look up by chart name
getTemplateChannels(name)
```

### Semantic types (~70 types)

| Group | Examples |
|-------|---------|
| Temporal | `DateTime`, `Date`, `Year`, `Month` |
| Measures | `Quantity`, `Count`, `Price`, `Percentage` |
| Discrete numerics | `Rank`, `Score`, `ID` |
| Geographic | `Latitude`, `Longitude`, `Country`, `City` |
| Categorical | `PersonName`, `Company`, `Status`, `Boolean` |
| Ranges | `Range`, `AgeGroup`, `Bucket` |
| Fallbacks | `String`, `Number`, `Unknown` |

---

## What the compiler handles automatically

- **Sizing** — spring model for discrete axes, pressure model for continuous;
  composable with facets and layers. No more 6400 px charts from 80 × 4 facets.
- **Zero baseline** — Revenue → include zero; Temperature → don't; Rank → don't.
- **Scale direction** — Rank → reversed; others → normal.
- **Formatting** — Revenue → `$,.0f`; Percentage → `.0%`; Year → `%Y`.
- **Color schemes** — categorical codes → distinct hues; measures → sequential.
- **Label overflow** — auto-rotation and truncation from count + string lengths.
- **Bespoke marks** — lollipops, bump charts, candlesticks as single templates.
- **Semantic validation** — actionable errors before rendering, not after crashing.

## Design principles

1. **No UI dependencies** — pure data-in, spec-out.
2. **Semantic types drive everything** — the caller annotates fields; the
   compiler derives all VL config. Fallback: `inferVisCategory()` inspects raw data.
3. **Callers own the data** — no aggregation transforms applied.
4. **Layout is configurable** — elastic stretch, facet sizing, step sizes
   exposed in `AssembleOptions`.
5. **Templates are declarative** — each chart type is a `ChartTemplateDef`
   with a VL skeleton, channel list, and optional post-processor.
6. **Backend-agnostic semantics** — the same semantic reasoning can target
   Vega-Lite today, ECharts or Plotly tomorrow.
