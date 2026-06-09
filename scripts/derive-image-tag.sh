#!/usr/bin/env bash
# derive-image-tag.sh -- print the container image tag to render into the
# Helm values templates.
#
# Resolution order:
#   1. $SWA_IMAGE_TAG if non-empty (manual override -- highest priority).
#   2. <release>-arm64v8 where <release> is parsed from
#      .swa-release/manifest.txt's `release:` line (default).
#
# Apple-Silicon-only: the suffix is hardcoded to -arm64v8 because the
# bundle's amd64 image variants will not run on this demo's target host.

set -euo pipefail

if [[ -n "${SWA_IMAGE_TAG:-}" ]]; then
  echo "$SWA_IMAGE_TAG"
  exit 0
fi

MANIFEST=.swa-release/manifest.txt
if [[ ! -f "$MANIFEST" ]]; then
  echo "derive-image-tag: $MANIFEST not found; run 'make unpack' first" >&2
  exit 1
fi

ver=$(awk -F': *' '/^release:/ {gsub(/^v/,"",$2); print $2; exit}' "$MANIFEST")
if [[ -z "$ver" ]]; then
  echo "derive-image-tag: could not parse 'release:' line from $MANIFEST" >&2
  exit 1
fi

echo "${ver}-arm64v8"
