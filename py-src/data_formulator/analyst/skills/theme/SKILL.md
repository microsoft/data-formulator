---
name: theme
description: Author chart themes (colors, type, axes, marks) as Flint ThemeSpecs and save them to the user's theme library for reuse in every session.
when_to_use: >-
  The user wants a house style, brand, or publication look for charts and apps
  ("use our brand colors", "make it look like the FT", "save this style"), wants
  to revise or reuse a saved theme, or names a theme that is not a Flint preset.
  Not for applying an existing preset or saved theme to a chart: set the chart
  file's "theme" (or an app's Page theme) directly.
always_on: false
tools:
  - list_themes
  - save_theme
---

# Chart themes

A theme is a reusable visual system for charts: surfaces, text and series
colors, type, axes and grids, mark geometry, labels and legends. It never
chooses data: no fields, encodings, aggregation, sorting, or titles.

Flint ships presets (`nyt`, `economist`, `swiss`, `nature`, `mckinsey`,
`datawrapper`, `powerbi`, `powerbi-light`, `pop`, `cartoon`, `apple`,
`de-stijl`, `bbc`, `material`). The user's own themes live in their theme
library: `list_themes` shows them in full, and `save_theme` adds one or
replaces the one with the same id. A saved theme works by id everywhere a
preset does, in this and later sessions: a chart file's `"theme"`, a map's
`view.theme`, an app's `<Page theme="…">` (which also styles the page) or
`FlintChart theme`, and the canvas theme picker.

## Workflow

1. `list_themes` first: reuse or revise a saved theme that fits rather than
   making a near-duplicate. To revise one, save it again with the same `id`.
2. Read the references the user gives (brand colors, a site, a publication)
   for recurring decisions, not one-off decoration. Ask only about decisions
   that change the theme materially (the colors that must appear, a dark or
   light page) when the request does not settle them.
3. Choose a base: `extends` a preset whose layout and typography already fit
   (an editorial look: `nyt`, `economist`, `datawrapper`; a business
   dashboard: `powerbi-light`, `material`) and override only what differs.
   Write a standalone theme only when no preset is close.
4. `save_theme` with the smallest coherent spec, then apply it (set the
   charts' `"theme"`, or the app's `Page theme`) so the user sees it.

## The spec

```json
{
  "id": "acme",
  "label": "Acme",
  "description": "Acme brand: navy and orange on white, Inter.",
  "extends": "datawrapper",
  "ink": {
    "surface": { "source": "host" },
    "text": { "primary": "#14213d", "secondary": "#4a5468", "muted": "#7a8396" },
    "structure": { "axis": "#14213d", "grid": "#e3e6ec" },
    "series": {
      "single": "#14213d",
      "categorical": ["#14213d", "#fca311", "#2a9d8f", "#e76f51", "#8d99ae"],
      "categoricalExtended": ["#14213d", "#fca311", "#2a9d8f", "#e76f51", "#8d99ae", "#6a4c93", "#b5838d", "#588157"]
    },
    "accent": "#fca311"
  },
  "type": {
    "headline": { "family": "Inter, 'Helvetica Neue', Arial, sans-serif", "weight": "bold" },
    "axisLabel": { "family": "Inter, 'Helvetica Neue', Arial, sans-serif" }
  }
}
```

- `id` (kebab-case, not a preset id) and `label` are required; `description`
  says what the theme is for, so it can be found again.
- Top-level parts: `ink`, `type`, `structure`, `marks`, `labels`, `legend`,
  `dataLabels`, `annotation`, `source`, `furniture`, `facets`, `layout`,
  `geometry`, `chartDefaults`, `compileDefaults`, `interaction`, `variants`.
  Do not invent keys. Nested objects merge into the preset; arrays and values
  replace it: replacing `ink.series.categorical`, also replace
  `categoricalExtended`.
- Colors are hex (`#rrggbb`). Font families are CSS stacks with fallbacks;
  do not assume a brand font is installed.
- `ink.surface`: `{ "source": "host" }` draws charts on whatever they sit on
  (the canvas, an app page, a card), which suits most themes. A theme with its
  own paper (a dark dashboard, a cream page) sets `{ "source": "house",
  "canvas": "#1b1a19", "plot": "#1b1a19", "panel": "#252423" }` and text inks
  that read on it; an app page with that theme takes the panel as its page
  and the plot as its tiles.
- `ink.series`: `single` (one-series charts), `categorical` (an ordered
  identity set, adjacent colors distinguishable), `categoricalExtended` (for
  more series), `overflow` (the rest), `sequential` and `diverging`
  (`{ "stops": [...], "space": "lab" }`, ordered lightness, a meaningful
  neutral for diverging), `status` (`positive`, `negative`, `neutral`, only
  for that meaning). `ink.accent` marks emphasis.
- `type` roles (`headline`, `deck`, `axisLabel`, `axisTitle`, `valueLabel`,
  `keyLabel`, `keyTitle`, `annotation`, `kicker`, `display`) take `family`,
  `size`, `weight` (`regular`, `medium`, `semibold`, `bold`), `style`, `case`
  (`upper`, `lower`, `title`, `sentence`, `asIs`), and `color`.
- `structure`: axes by role (`categorical`, `measure`), `grid`, `baseline`,
  `frame`, each a presence (`omit`, `hairline`, `quiet`, `full`,
  `emphasised`) or `{ presence, style, dash, weight, color }`.
- `furniture`: house rules and tabs around the title, e.g. the `economist`
  red tab: `[{ "kind": "tab", "at": "canvasTop", "frame": "content", "align":
  "start", "color": "#e3120b", "width": 44, "height": 12 }]`. Use only what
  the house really draws.
- `layout.density`: `compact`, `normal`, or `airy`.

## Check before saving

- Text and axis inks read against the surface; series colors are
  distinguishable and readable on the plot; ramps run light to dark.
- It states reusable rules, not one chart's decoration, and holds for bars,
  lines, areas, pies, scatters and facets alike.
- The result of `save_theme` lists every problem when it is rejected; fix them
  all and save again.
