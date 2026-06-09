#!/usr/bin/env bash
# unpack-release.sh -- idempotent extraction of the SWA release TGZ.
#
# Reads $SWA_RELEASE_TGZ (default swa-release-v1.0.0.tgz), extracts into
# .swa-release/ at the repo root, and writes a marker file so re-runs are
# no-ops when the source TGZ is unchanged. Safe under `make -j` via flock.

set -euo pipefail

TGZ="${SWA_RELEASE_TGZ:-swa-release-v1.0.0.tgz}"
if [[ ! -f "$TGZ" ]]; then
  echo "unpack-release: missing $TGZ in repo root" >&2
  echo "                (override the filename with SWA_RELEASE_TGZ in .envrc)" >&2
  exit 1
fi

DIR=.swa-release
MARK="$DIR/.tgz-source"
LOCK=/tmp/.swa-release.lock

# Use flock when available (Linux + macOS with `brew install util-linux`).
# When missing, run unlocked: `make` dedupes the `unpack` target within a
# single invocation, so the only realistic race is two parallel `make` shells
# in separate terminals -- rare enough to leave as the user's responsibility.
do_unpack() {
  sha=$(shasum -a 256 "$TGZ" | awk '{print $1}')
  want="tgz=$(basename "$TGZ")"$'\n'"sha256=$sha"
  if [[ -f "$MARK" && "$(cat "$MARK")" == "$want" ]]; then
    return 0
  fi
  rm -rf "$DIR"
  mkdir -p "$DIR"
  tar -xzf "$TGZ" -C "$DIR"
  printf '%s\n' "$want" > "$MARK"
  echo "unpack-release: extracted $TGZ -> $DIR/"
}

if command -v flock >/dev/null 2>&1; then
  (
    flock -x 9
    do_unpack
  ) 9>"$LOCK"
else
  do_unpack
fi
