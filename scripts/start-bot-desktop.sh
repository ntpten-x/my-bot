#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for arg in "$@"; do
  if [[ "$arg" == '--help' || "$arg" == '--check' || "$arg" == '--password-window' ]]; then
    exec node "$ROOT_DIR/scripts/start-bot-desktop.mjs" "$@"
  fi
done
umask 077
mkdir -p "$ROOT_DIR/data/bot-desktop"
exec 9>"$ROOT_DIR/data/bot-desktop/run.lock"
flock -n 9 || { echo 'The MY-BOT desktop is already running. Use the existing viewer.' >&2; exit 1; }
exec node "$ROOT_DIR/scripts/start-bot-desktop.mjs" "$@"
