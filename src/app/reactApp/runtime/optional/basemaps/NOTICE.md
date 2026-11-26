# Flint's basemaps, for apps

Apps run without a network, so the boundaries Flint's maps name by URL
(`https://microsoft.github.io/flint-chart/geo/v1/<file>.json`) are answered from bundled copies
(`runtime/chart.tsx`, `resolveBasemaps`). The US and Natural Earth files come from the `us-atlas` and
`world-atlas` packages; the World Bank files here are Flint's published `geo/v1` files, copied
unchanged. A published Flint geo version never changes, so a copy stays valid for every spec that
names `v1`; a new version would be added beside it.

| File | Source | Licence |
|---|---|---|
| `world-bank-coarse.json`, `world-bank-medium.json` | [World Bank Official Boundaries](https://datacatalog.worldbank.org/search/dataset/0038272/world-bank-official-boundaries), as published by Flint at `geo/v1` (ISO 3166-1 numeric ids, a `disputed` mesh) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), © The World Bank Group |

Changes to the World Bank data (by Flint): territories sharing an ISO 3166-1 alpha-3 code were
merged; France's overseas departments take France's id; geometry was simplified. Maps drawn from it
credit the World Bank at their foot, with its disclaimer:

> The boundaries, colors, denominations, and any other information shown on maps made with these
> files do not imply any judgment on the part of The World Bank concerning the legal status of any
> territory or the endorsement or acceptance of such boundaries.
