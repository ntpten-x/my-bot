#!/usr/bin/env bash
# Open the lightweight file manager in the bot desktop. Do not use Chromium for folders.
set -euo pipefail
[[ -n "${DISPLAY:-}" ]] || { echo 'DISPLAY is required' >&2; exit 1; }
TARGET="${1:-$HOME}"
if [[ ! -d "$TARGET" ]]; then TARGET="$HOME"; fi
if ! command -v pcmanfm >/dev/null 2>&1; then
  echo 'pcmanfm is not installed' >&2
  exit 1
fi
exec pcmanfm "$TARGET"
