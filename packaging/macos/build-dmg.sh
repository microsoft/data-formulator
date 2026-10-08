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
mkdir "$staging/payload"
ditto "$app_path" "$staging/payload/Data Formulator.app"
ln -s /Applications "$staging/payload/Applications"
for attempt in 1 2 3; do
    image="$staging/candidate-$attempt.dmg"
    log="$staging/create-$attempt.log"
    if hdiutil create -volname 'Data Formulator' -srcfolder "$staging/payload" \
        -format UDZO -fs HFS+ "$image" >"$log" 2>&1; then
        cat "$log"
        hdiutil verify "$image"
        mv "$image" "$output_path"
        exit 0
    else
        status=$?
        cat "$log" >&2
        if [[ $attempt -eq 3 ]] || ! grep -q 'hdiutil: create failed - Resource busy' "$log"; then
            exit "$status"
        fi
        printf 'Disk image resource busy; retrying (%s/3).\n' "$attempt" >&2
        sleep 10
    fi
done