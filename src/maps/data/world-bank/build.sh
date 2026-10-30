#!/usr/bin/env bash
# Build the world basemaps in this folder from World Bank Official Boundaries
# (CC BY 4.0, https://datacatalog.worldbank.org/search/dataset/0038272/world-bank-official-boundaries).
#
# Usage: src/maps/data/world-bank/build.sh <Admin 0 GeoJSON> <NDLSA GeoJSON>
#
# Writes three TopoJSON levels of detail (coarse, medium, fine), each with:
#   countries  one feature per ISO alpha-3 code (territories sharing a code are merged), id = ISO_A3;
#              non-determined legal status areas (NDLSA: Jammu and Kashmir, Aksai Chin, Western Sahara,
#              Abyei, …) as their own features, id = their ISO code or "NDLSA-<name>", ndlsa = true
#   land       the dissolved land outline (the coastline)
# Requires Node (runs mapshaper through npx).
set -euo pipefail

admin0="$1"
ndlsa="$2"
out="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

ms() { npx -y mapshaper@0.6 "$@"; }

# One layer: countries dissolved by ISO code, plus the NDLSA areas with their own ids.
ms -i "$admin0" name=admin \
  -each 'id = ISO_A3; name = NAM_0; ndlsa = false' \
  -dissolve id copy-fields=name,ndlsa \
  -o "$work/admin.json" format=geojson
ms -i "$ndlsa" name=ndlsa \
  -each 'name = String(NAM_0).trim(); ndlsa = true;
         id = ISO_A3 ? ISO_A3 : "NDLSA-" + name.replace(/[^A-Za-z]+/g, "-").replace(/^-|-$/g, "") + (SOV_ISO_A3 ? "-" + SOV_ISO_A3 : "")' \
  -filter-fields id,name,ndlsa \
  -o "$work/ndlsa.json" format=geojson

# Detail levels: about the size of Natural Earth's 1:110m, 1:50m, and 1:10m country files.
build() {
  local level="$1" percent="$2"
  ms -i "$work/admin.json" "$work/ndlsa.json" combine-files \
    -merge-layers force name=countries \
    -simplify visvalingam weighted percentage="$percent" keep-shapes \
    -clean \
    -dissolve + name=land \
    -o "$out/$level.json" format=topojson id-field=id quantization=100000 target=countries,land
}
build coarse 0.25%
build medium 2%
build fine 12%

ls -la "$out"
