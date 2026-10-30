---
name: map
description: >-
  Build an interactive map from workspace data: choropleths, bubbles, points,
  density, hexbins, flows, spikes, paths, and labels over world, US state or
  county, or custom boundaries, with optional street tiles, a globe, and
  controls such as a time slider, metric switch, filters, and search.
when_to_use: >-
  The user asks for a map or anything geographic (by country, state, county,
  city, region, coordinates, routes, origins and destinations), or asks to
  change an existing map (*.map.json). Prefer it over a chart for geographic
  data and over an app for map-centred dashboards. Not for non-geographic
  charts (use visualize).
always_on: false
tools: []
actions:
  - write_map
---

# Skill: Maps

A map is a JSON spec saved as `files/<name>.map.json` with `write_map`; the
built-in map renderer draws it on the canvas, reading workspace tables live.
The user can pan, zoom (double-click a region to zoom to it), hover for
tooltips, click to select (shift adds), and restyle layers in the Style panel.

## Plan

1. Ground it in data. Find the table and the exact columns that place each
   row: a region key (country code or name, US state, county FIPS, or a
   property of a custom boundary file) or longitude/latitude. Derive a tidy
   table first with `create_data` when needed: one row per place (or per place
   and period for a time slider), with clean numeric measures. Aggregate large
   data per place with `sql` rather than drawing raw rows.
2. Pick the template (below) that fits the question:
   - Rates, shares, per-capita values by region: `choropleth`.
   - Counts or totals by region or city: `bubbles` (area-true), or `spikes`
     for many overlapping places; `cartogram` to size regions by value.
   - Individual locations: `points` (thousands are fine); many overlapping
     points: `density` (hexagon bins or a heatmap).
   - Origin → destination: `flows` (`"curve": "great-circle"` for flights or
     shipping). Ordered tracks (routes, storms): `tracks`. Both show which way
     they go with an arrowhead at the destination; `direction` can instead be
     `animate` (moving dashes), `taper`, or `none` — use `none` for routes
     from one hub (every line leaves it; the hub is marked and named). With
     coordinates, also bind `origin`/`destination` to the place names: they
     label the ends. A flat world map centres on the Pacific by itself when
     that keeps more routes whole; leave `view.rotate` unset. For routes
     reaching both Asia and Europe, a globe (`projection: orthographic`)
     shows every route whole. Give flows a dark,
     non-blue `color` (e.g. `"#c0392b"`, `"#7a5195"`, `"#3d3d3d"`) unless a
     colour column is bound: blue lines read as rivers and sea routes.
   - Wind, currents, or headings at places: `vectors` — one row per grid cell
     or station with lat, lon, and either `angle` (degrees clockwise from
     north, the way it points) or `u`+`v` (east and north components; their
     length sizes the arrow unless `size` is bound). Convert "wind from"
     bearings by adding 180°.
   - Two related rates at once (income vs. poverty): `bivariate`.
   Never encode totals with a choropleth (big regions dominate); normalize to
   rates or use bubbles. Use the layer spec for several layers, labels-only
   maps, or boundary overlays (`shapes`).
3. Bind only the channels the question needs: `time` for a playable slider,
   `filter` for a short category column (at most 30 values; never a measure).
   Offer alternatives as options (below) rather than leaving people to pick
   columns themselves: when the data has other comparable measures (same
   unit or kind: fossil/nuclear/renewable TWh, several rates), the main
   measure channel lists them, 2–4 with the asked-for one first, so the map
   gets a switch; useful category columns go in filter options. Extra `controls` (a `range` filter, `stats`) can sit
   beside a template; layer toggles need the layer spec.
4. Read the result: `write_map` returns `warnings` (unmatched keys, missing
   coordinates, constant controls). Fix real problems (clean names, set
   `keyType`, filter out aggregates like "World") with `edit_file`.

## Templates (use these first)

A template is a kind of map bound to columns. Pick one, bind the columns, and
let the fields' semantics, the theme, and the style decide the rest:

```json
{"template": "choropleth",
 "data": {"table": "indicators"},
 "encoding": {"region": "country", "color": "life_expectancy", "time": "year"},
 "fields": {"life_expectancy": {"semanticType": "Quantity", "unit": "years"}},
 "properties": {"classes": 5},
 "view": {"style": "light"}}
```

| template | needs | also takes |
|---|---|---|
| `choropleth` | region, color (a rate, not a total) | label, time, filter |
| `bubbles` | region or lat+lon, size | color, label, time, filter |
| `points` | lat+lon | color, size, label, time, filter |
| `density` | lat+lon | weight, time, filter |
| `spikes` | region or lat+lon, size | color, label, time, filter |
| `flows` | origin or originLat+originLon, destination or destinationLat+destinationLon | size, color, time, filter |
| `tracks` | lat+lon, group | order, color, size, time, filter |
| `bivariate` | region, color, color2 | label, time, filter |
| `cartogram` | region, size | color, label, time, filter |
| `vectors` | lat+lon, angle or u+v | size, color, time, filter |

Channels name columns. `time` adds a playable slider; `filter` adds
checkboxes; `tooltip` (a list) sets the tooltip fields.

The choice channels — `color`, `color2`, `size`, `weight`, `label`, `time`,
`filter` — also take options, the columns people may choose among:

- `"size": ["fossil_twh", "nuclear_twh", "renewable_twh"]` shows the first;
  several measure options put a switch on the map (color and size given the
  same list share one switch).
- `"filter": {"field": "continent", "options": ["continent", "income_group"]}`
  shows `field`; leave `field` out to offer a channel without showing it
  (e.g. `"time": {"options": ["year"]}` for a slider people can turn on).

The Style panel lets people pick among these options (and None for optional
channels); it does not offer other columns, so offer what is worth choosing.
Where marks go (region, lat/lon, origin/destination, group, order) takes one
column. Properties (all
optional): `geography` (`world`, `us-states`, `us-counties`, or a
`files/…` GeoJSON with `featureKey`), `keyType`, `classes`, `method`,
`scheme`, `color`, `sizeMax`, `opacity`, `density` (`hexbin` or `heatmap`), `radius`,
`curve` (flows), `direction` (flows and tracks: `taper`, `arrow`, `animate`,
`none`), `play` (false: no play button), `search`, `details`
(default on), `stats` (default off). `fields`, `view`, `title`-level text
(`subtitle`, `source`), and extra `controls` work as below. Marks are already
semi-transparent with outlines: leave `opacity` unset unless a dense layer
needs fading, or the map turns washed out.

Colour: bind the `color` channel when colour encodes data. Otherwise every
mark takes one colour: the theme's, unless `properties.color` (any CSS
colour) sets it. Set it when the measure has a conventional colour — fossil
fuels dark grey or brown, renewables green, emissions and heat warm red or
orange, rain and water blue — or to keep a map consistent with related
charts; leave it unset otherwise. `properties.scheme` picks the ramp for a
colour column, or for density (hexbins and heatmaps). In a layer spec, use
`color: {"value": "#…"}` or `color: {"field", "scheme"}`.

The user can switch the map type, choose among the offered columns, and
change these properties in the Style panel. Write a layer spec (below) only when the map
needs several layers (e.g. density under points, regions under bubbles) or
linked layers.

## Layer spec

```json
{
  "subtitle": "Life expectancy at birth, 1960–2020",
  "source": "World Bank",
  "view": {"basemap": "world", "projection": "equalEarth"},
  "data": {"le": {"table": "life_expectancy"}},
  "fields": {"life_exp": {"semanticType": "Quantity", "unit": "years", "displayName": "Life expectancy"}},
  "layers": [
    {"id": "le", "type": "regions", "data": "le", "key": "iso3",
     "color": {"field": "life_exp", "aggregate": "mean"},
     "tooltip": ["country", "life_exp"]}
  ],
  "controls": [
    {"type": "slider", "field": "year", "data": "le", "play": true},
    {"type": "search", "layer": "le"},
    {"type": "details", "layer": "le"}
  ]
}
```

`write_map` takes `title` and `map` (this object without the title).

### view

- `basemap`: `world` (default), `world-detailed`, `us-states`, `us-counties`,
  `none`. Basemaps are offline.
- `projection`: `equalEarth` (world default), `naturalEarth`, `mercator`,
  `equirectangular`, `orthographic` (a globe: drag to rotate; `spin: true`
  rotates it until touched), `albersUsa` (US default; insets Alaska and
  Hawaii), `albers`, `conicEqualArea`, `azimuthalEqualArea`, `stereographic`,
  `transverseMercator`.
- `tiles`: `light`, `dark`, `streets` adds online street-map tiles (needs
  network; uses Mercator) — for city-scale points, routes, or when the user
  wants streets. Omit for country/state-level maps.
- `fit`: leave it unset. The map frames the data (European data shows
  Europe) and shows the whole world, without Antarctica, when the data spans
  it. `basemap` forces the whole basemap even for regional data; use it only
  when the user asks for the world context. `center` `[lon, lat]` with `zoom`
  (1 = whole basemap) sets an explicit view.
- `graticule: true` draws latitude/longitude lines.
- `style`: the basemap's look — `light` (default; Datawrapper-like grey land
  with white borders on the page), `muted` (near-white land drawn by grey
  borders: a stage for strong colours), `atlas` (blue water filling the
  frame, warm land), `dark` (dark water filling the frame), `minimal`
  (outlines, for print). Leave it unset unless the user asks for a look.
- `theme`: a chart theme (`datawrapper`, `nyt`, `economist`, `swiss`,
  `nature`, `mckinsey`, `powerbi`, `powerbi-light`, `pop`, `cartoon`, or
  `none`); it sets the title font, single and categorical colours, and the
  sequential and diverging ramps. Omit it to follow the app's chart theme, so
  maps match the session's charts.
- `labels: false` hides country and state names (shown where they fit).

### fields: say what the data is, not how to colour it

Annotate the measures the map encodes with Flint semantic types, as charts
do. The map then picks the rest: aggregation (counts and amounts sum, rates
and averages average), diverging colours around a midpoint for signed
measures, units and currency in legends and tooltips, and readable labels.

```json
"fields": {
  "gdp_per_capita": {"semanticType": "Price", "unit": "USD", "displayName": "GDP per capita"},
  "unemployment": {"semanticType": "Percentage"},
  "vote_margin": {"semanticType": "PercentageChange", "unit": "pts"},
  "temp_anomaly": {"semanticType": "Temperature", "unit": "°C", "divergingMidpoint": 0},
  "population": "Count"
}
```

Common types: `Count`, `Amount` (money totals), `Price` (money per unit or
per person), `Percentage`, `PercentageChange`, `Profit`, `Quantity`,
`Temperature`, `Score`, `Number`. `divergingMidpoint` declares the
comparison (an average, a target). Tables in the session usually carry these
annotations already; `fields` overrides them. Prefer this over setting
`scheme`, `type`, `midpoint`, `format`, or `title` by hand; set those only
when the default is wrong.

### data

Named sources: `{"table": "name"}`, `{"sql": "select …", "tables": ["a",
"b"]}` (read-only DuckDB over workspace tables, by table name), or
`{"values": [...]}` for a few hand-made rows (≤ 2,000). Up to 50,000 rows are
read per source.

### layers

Common keys: `id` (unique; controls name layers by it), `type`, `name`
(legend/layer list), `data`, `filter` (`[{"field", "op", "value"}]`, ops
`== != > >= < <= in between contains`), `opacity`, `visible`, `tooltip`
(fields as names or `{"field", "label", "format"}`; `false` hides it), `text`
(a label field).

Placing rows:
- Regions: `key` (column) with optional `keyType`: `auto` (default; detects
  ISO numeric, ISO2, ISO3, names), `iso3`, `iso2`, `iso-numeric`,
  `country-name`, `us-state` (names, USPS codes, or FIPS), `fips` (5-digit
  counties), `property`. `geo` chooses the boundaries: `countries`,
  `us-states`, `us-counties`, or a workspace file `files/x.geojson`
  (GeoJSON or TopoJSON) with `featureKey` naming the feature property the key
  matches (case-insensitive). Without `geo`, the basemap decides.
- Coordinates: `lon` and `lat` columns.
- Flows: `from` and `to`, each `{"key": …}` (region centroid) or
  `{"lon": …, "lat": …}`.
- Paths: `lon`, `lat`, `group` (one line per value), `order` (sort field).

Rows that share a region (or point) are aggregated: `color.aggregate`
defaults to `mean`, `size.aggregate` to `sum`; set `sum`, `mean`, `median`,
`min`, `max`, `count`, or `first` to match the measure.

Encodings:
- `color`: `{"field", "type", "scheme", "method", "classes", "thresholds",
  "domain", "midpoint", "reverse", "aggregate", "format", "title"}` or
  `{"value": "#hex"}`. Numbers default to 5 quantile classes; `method`:
  `quantile`, `equal`, `jenks` (natural breaks), `threshold` (with
  `thresholds`), `continuous`, `log`. Diverging data (change, anomaly, vote
  margin): `"type": "diverging"` with `midpoint` (default 0) and a diverging
  scheme (`rdBu`, `rdYlBu`, `rdYlGn`, `brBG`, `piYG`, `puOr`, `prGn`,
  `spectral`). Sequential schemes: `blues`, `greens`, `oranges`, `reds`,
  `purples`, `greys`, `viridis`, `magma`, `inferno`, `plasma`, `cividis`,
  `ylOrRd`, `ylGnBu`, `buPu`, … Text fields are categorical (`tableau10`,
  `set2`, `dark2`, `paired`, …); the legend toggles categories.
- Bivariate: `{"type": "bivariate", "field", "field2", "scheme"}` colours
  3×3 tertile classes of two measures (`blueRed`, `purpleGold`, `greenPink`)
  with a grid legend.
- `prefix`/`suffix` on colour and size add text around numbers (`"$"`, `" kt"`).
- `size`: `{"field", "max", "min", "aggregate", "format", "title"}` or
  `{"value": n}`. Bubbles: max radius (default 32 px, area-true); spikes:
  max height (120); flows/paths: max width (10).
- `hexbin`/`heatmap`: `radius` (px), `weight` (field); hexbins colour by
  count, or by `color.field` with `color.aggregate`.
- `vectors`: `lon`, `lat`, and `angle` (degrees clockwise from north) or `u`
  and `v`; `size` sets arrow length (default max 28 px), `color` as usual.

Other layer options: `curve` on flows (`arc` default, `great-circle` default
on the globe, `straight`); `direction` on flows and paths (`arrow`,
`taper`, `animate`, `none`; layers default to none, templates to arrow); `"layout": "dorling"` on bubbles;
`selectionFilter: {"layer": "states", "field": "state", "by": "state"}`
shows only rows whose `field` matches the rows the user selected in another
layer (`by` names that layer's field; default `field`) — click a state to see
its stores.

`{"param": "name"}` can replace `color.field`, `size.field`, a filter's
`field`, or a filter's `value`, so a control drives it.

### controls

- `slider`: `field` + `data` steps through the field's values (years, dates)
  and filters that data's layers to the current value; `play: true` adds a
  play button (`interval` ms per step, default 350); a time-like slider joins the
  widget group. Without `field`: a numeric `param` with `min`, `max`, `step`.
- `select`: `options` `[{"label", "value"}]` sets `param` (e.g. switch the
  colour field: options are column names, layers use `{"param": "metric"}`),
  or `field` + `data` lists the field's values and filters (with "All").
- `checkboxes`: `field` + `data` (or `options`): show only the checked values.
- `range`: `field` + `data`: a two-ended numeric filter.
- `search`: find a place by name and zoom to it (`layer` limits it).
- `layers`: toggle layer visibility.
- `details`: a side panel with the clicked place's fields (`fields`, `layer`).
- `stats`: a summary of a layer's places (count, total or average, top 5)
  that follows the selection (`layer`, `fields`, `label`).

A time slider keeps one colour and size scale across its frames, so frames
compare. Users can also shift-drag (or use the selection tool) to lasso
marks; `details` and `stats` then describe the selection.

A control with `field` filters every layer reading its `data` (or, without
`data`, every layer whose rows have the field); set `"filter": false` to only
set the param. `value` sets the initial value (sliders default to the latest).

## Examples

US states, metric switch, labels:

```json
{"view": {"basemap": "us-states"},
 "data": {"s": {"table": "state_stats"}},
 "layers": [{"id": "states", "type": "regions", "data": "s", "key": "state", "keyType": "us-state", "text": "abbr",
   "color": {"field": {"param": "metric"}, "scheme": "blues"}, "tooltip": ["state", "population", "median_income"]}],
 "controls": [{"type": "select", "param": "metric", "label": "Measure",
   "options": [{"label": "Median income", "value": "median_income"}, {"label": "Poverty rate", "value": "poverty_rate"}]},
   {"type": "stats", "layer": "states"}]}
```

City points on street tiles, by category, with a density view:

```json
{"view": {"tiles": "light"},
 "data": {"trips": {"sql": "select lon, lat, kind, fare from rides where fare > 0", "tables": ["rides"]}},
 "layers": [
   {"id": "density", "type": "hexbin", "data": "trips", "lon": "lon", "lat": "lat", "radius": 14, "name": "Trips per hexagon"},
   {"id": "pts", "type": "points", "data": "trips", "lon": "lon", "lat": "lat", "color": {"field": "kind"}, "visible": false}],
 "controls": [{"type": "layers"}, {"type": "checkboxes", "field": "kind", "data": "trips"}]}
```

Flows on a globe:

```json
{"view": {"projection": "orthographic", "spin": true},
 "data": {"m": {"table": "migration"}},
 "layers": [{"id": "flows", "type": "flows", "data": "m", "from": {"key": "origin_iso3"}, "to": {"key": "dest_iso3"},
   "size": {"field": "migrants"}, "color": {"value": "#e15759"}}]}
```

Custom boundaries: save the GeoJSON/TopoJSON as a workspace file first (for
example with `execute_python_script` + `create_file`), then
`"geo": "files/regions.geojson", "featureKey": "NAME"` on the layer. Ask the
user for boundaries you do not have; do not invent geometry.

## Revising

Small changes (scheme, classes, a filter, a control): `edit_file` with
targeted replacements on the JSON and the map's `content_hash`. Rewrites:
`write_map` with `path` and `expected_content_hash`. The user's Style-panel
edits are saved into the same file, so read it before rewriting.
