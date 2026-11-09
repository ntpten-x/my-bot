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
# Keep the unzip-based archiver shim ahead of stock xarchiver for Extract Here.
SHIM_BIN="${MYBOT_DESKTOP_BIN:-/var/lib/mybot-desktop/bot-desktop/bin}"
if [[ -x "$SHIM_BIN/xarchiver" && -x "$SHIM_BIN/extract-archive.sh" ]]; then
  export PATH="$SHIM_BIN:${PATH:-/usr/bin:/bin}"
fi
exec pcmanfm "$TARGET"
