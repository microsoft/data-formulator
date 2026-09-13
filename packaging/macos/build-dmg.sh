#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
    printf 'Usage: bash packaging/macos/build-dmg.sh APP_PATH OUTPUT_DMG\n' >&2
    exit 2
fi

app_path="$1"
output_path="$2"
if [[ ! -f "$app_path/Contents/MacOS/Data Formulator" ]]; then
    printf 'Missing Data Formulator application: %s\n' "$app_path" >&2
    exit 1
fi
if [[ -e "$output_path" ]]; then
    printf 'Refusing to overwrite existing disk image: %s\n' "$output_path" >&2
    exit 1
fi

staging="$(mktemp -d "${TMPDIR:-/tmp}/data-formulator-dmg.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
mkdir -p "$(dirname "$output_path")"
ditto "$app_path" "$staging/Data Formulator.app"
ln -s /Applications "$staging/Applications"
hdiutil create -volname 'Data Formulator' -srcfolder "$staging" \
    -format UDZO -fs HFS+ "$output_path"
hdiutil verify "$output_path"