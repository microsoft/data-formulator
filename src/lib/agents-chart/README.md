# agents-chart

Pure-TypeScript chart assembly library. Given data, semantic types, encoding
definitions, and a canvas size, produces a Vega-Lite specification.
No React / Redux / UI framework dependencies.

## Quick start

```ts
import { assembleChart } from './lib/agents-chart';

const spec = assembleChart(
  'Scatter Plot',
  { x: { field: 'weight' }, y: { field: 'mpg' }, color: { field: 'origin' } },
  myData,                                     // any[]  – rows of objects
  { weight: 'Quantity', mpg: 'Quantity', origin: 'Country' },  // semantic types
  { width: 400, height: 300 },                // canvas size in px
);
```

## Architecture

```
index.ts            ← barrel file / public API
types.ts            ← core type definitions (encoding, template, options)
semantic-types.ts   ← semantic type lattice + VisCategory helpers
assemble.ts         ← assembleChart() + resolveEncodingType()
templates/          ← chart template definitions (bar, scatter, map, …)
```

### Type resolution pipeline

The library resolves every encoding channel's Vega-Lite type through a single,
unified pipeline implemented in `resolveEncodingType()` (internal to
`assemble.ts`):

```
                    ┌─────────────────┐
                    │  semantic type   │  (e.g. "Quantity", "Country", "Date")
                    │  from caller     │
                    └────────┬────────┘
                             │
             has mapping?  ──┤
           ┌── yes ─────────┘└──── no ──────────┐
           ▼                                     ▼
  ┌─────────────────┐                   ┌────────────────────┐
  │ getVisCategory()│                   │ inferVisCategory() │
  │ (lookup table)  │                   │ (inspect raw data) │
  └────────┬────────┘                   └────────┬───────────┘
           │                                     │
           └──────────────┬──────────────────────┘
                          ▼
                 ┌────────────────┐
                 │  VisCategory   │   quantitative | ordinal | nominal
                 │                │   temporal | geographic
                 └────────┬───────┘
                          │
              channel / chart-type rules
              (bar binning, facet override,
               color cardinality, temporal
               validation …)
                          │
                          ▼
                 ┌────────────────┐
                 │  VL enc type   │   "quantitative" | "ordinal" | "nominal"
                 │  (string)      │   | "temporal"
                 └────────────────┘
```

**Key functions:**

| Function | Location | Exported? | Purpose |
|---|---|---|---|
| `resolveEncodingType()` | `assemble.ts` | No (internal) | Full pipeline: semantic type → VisCategory → VL encoding type, with channel/chart overrides |
| `getVisCategory()` | `semantic-types.ts` | Yes | Lookup: semantic type string → `VisCategory` |
| `inferVisCategory()` | `semantic-types.ts` | Yes | Infer `VisCategory` from raw data values (fallback when no semantic type) |

`inferVisCategory()` replaces the old `getDType()` / `inferFieldType()` / `inferPrimitiveType()` helpers. It inspects actual data values and maps them to the same `VisCategory` vocabulary used by the semantic type system:

| Data shape | VisCategory |
|---|---|
| All numbers | `quantitative` |
| All booleans | `nominal` |
| All date-parseable | `temporal` |
| Mixed / strings | `nominal` |

## Public API

### `assembleChart(chartType, encodings, data, semanticTypes, canvasSize, chartProperties?, options?)`

Main entry point. Returns a Vega-Lite spec object.

| Param | Type | Description |
|---|---|---|
| `chartType` | `string` | Template name, e.g. `"Scatter Plot"` |
| `encodings` | `Record<string, ChartEncoding>` | Channel → encoding map |
| `data` | `any[]` | Array of row objects |
| `semanticTypes` | `Record<string, string>` | Field name → semantic type string |
| `canvasSize` | `{ width: number; height: number }` | Canvas dimensions (pre-scaled) |
| `chartProperties?` | `Record<string, any>` | Chart property values (e.g. projection, inner radius) |
| `options?` | `AssembleOptions` | Tooltips, layout tuning |

### Types

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
  addTooltips?: boolean;       // add tooltips             (default false)
  elasticity?: number;         // axis stretch exponent    (default 0.5)
  maxStretch?: number;         // axis stretch cap         (default 2)
  facetElasticity?: number;    // facet stretch exponent   (default 0.3)
  facetMaxStretch?: number;    // facet stretch cap        (default 1.5)
  minStep?: number;            // min px per discrete tick (default 6)
  minSubplotSize?: number;     // min facet subplot px     (default 60)
}
```

### Template system

```ts
chartTemplateDefs   // Map<string, ChartTemplateDef>  — named templates
allTemplateDefs     // ChartTemplateDef[]              — flat list
getTemplateDef(name)  // look up by chart name
getTemplateChannels(name)  // get available channels
```

Each `ChartTemplateDef` can declare `properties?: ChartPropertyDef[]` for
configurable knobs (e.g. map projection, arc inner-radius). `ChartPropertyDef`
is a discriminated union:

```ts
type ChartPropertyDef = { key: string; label: string } & (
  | { type: 'continuous'; min: number; max: number; step?: number; defaultValue?: number }
  | { type: 'discrete';   options: { value: any; label: string }[]; defaultValue?: any }
  | { type: 'binary';     defaultValue?: boolean }
);
```

### Semantic type system (sub-module)

The full semantic type lattice is in `semantic-types.ts` — import directly:

```ts
import { isMeasureType, getVisCategory } from './lib/agents-chart/semantic-types';
```

~70 types organized into groups:

- **Temporal** — `DateTime`, `Date`, `Year`, `Month`, …
- **Measures** — `Quantity`, `Count`, `Price`, `Percentage`, …
- **Discrete numerics** — `Rank`, `Score`, `ID`, …
- **Geographic** — `Latitude`, `Longitude`, `Country`, `City`, …
- **Categorical** — `PersonName`, `Company`, `Status`, `Boolean`, …
- **Ranges** — `Range`, `AgeGroup`, `Bucket`
- **Fallbacks** — `String`, `Number`, `Unknown`

### Template helpers (sub-module)

Post-processor utilities in `helpers.ts` — import directly:

```ts
import { applyPointSizeScaling } from './lib/agents-chart/helpers';
```

### Channels

```ts
channels       // readonly tuple of valid channel names
channelGroups  // Record<string, string[]> — grouped channel names
```

## Design principles

1. **No UI dependencies** — pure data-in, spec-out.
2. **Semantic types drive everything** — the caller provides semantic type
   annotations; the library resolves them to VL encoding types via a single
   pipeline. When semantic types are missing, `inferVisCategory()` inspects
   the raw data as a fallback.
3. **Callers own the data** — data is assumed pre-aggregated. The library
   applies no aggregation transforms.
4. **Layout is configurable** — elastic stretch, facet sizing, and step sizes
   are exposed in `AssembleOptions` so the host app can tune them.
5. **Templates are declarative** — each chart type is a `ChartTemplateDef`
   with a VL skeleton, channel list, and optional post-processor.
