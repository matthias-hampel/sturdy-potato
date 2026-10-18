#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
profile="${1:-release}"
case "$profile" in
  release) cargo build --locked --release ;;
  debug) cargo build --locked ;;
  *) echo 'Usage: sh scripts/bundle.sh [release|debug]' >&2; exit 2 ;;
esac
bundle='dist/GeoTIFF Viewer.app'
mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
cp "target/$profile/geotiff-viewer" "$bundle/Contents/MacOS/geotiff-viewer"
cp packaging/Info.plist "$bundle/Contents/Info.plist"
codesign --force --sign - "$bundle"
echo "Built $PWD/$bundle"
