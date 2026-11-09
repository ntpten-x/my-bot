#!/usr/bin/env bash
# Focus or open Chromium with the dedicated bot profile only. Not the owner's personal Chrome.
set -euo pipefail
[[ -n "${DISPLAY:-}" ]] || { echo 'DISPLAY is required' >&2; exit 1; }
DATA_ROOT="${MYBOT_DATA_ROOT:-/var/lib/mybot-desktop}"
PROFILE="$DATA_ROOT/desktop-browser-profile"
CONFIG="$DATA_ROOT/bot-desktop/workstation-config.json"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$CONFIG" ]] || { echo 'Missing workstation config' >&2; exit 1; }
ORIGIN="$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(!/^https:\/\//.test(c.serverOrigin||"")) process.exit(1); console.log(c.serverOrigin)' "$CONFIG")"
BROWSER="$(command -v chromium || command -v chromium-browser || command -v google-chrome-stable || true)"
[[ -n "$BROWSER" ]] || { echo 'Chromium not found' >&2; exit 1; }
ARGS=(--user-data-dir="$PROFILE" --ozone-platform=x11 --no-first-run --new-window --start-maximized)
if [[ "${MYBOT_DESKTOP_PACKAGE:-}" == '1' && -d "$ROOT/extension" ]]; then
  ARGS+=(--load-extension="$ROOT/extension")
fi
# Same profile reuses the running Chromium session (focus / new window) via its singleton lock.
exec "$BROWSER" "${ARGS[@]}" "${ORIGIN}/" 'https://www.facebook.com/'
