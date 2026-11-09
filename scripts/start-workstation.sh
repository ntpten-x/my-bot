#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if ! command -v node >/dev/null 2>&1; then
  if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
    # Non-interactive WSL logon shells may not load nvm from .bashrc.
    source "${HOME}/.nvm/nvm.sh"
  fi
fi
command -v node >/dev/null 2>&1 || { echo 'Node.js is missing. Run setup first.' >&2; exit 1; }
umask 077
DATA_DIR="${MYBOT_DATA_ROOT:-$ROOT_DIR/data}"
mkdir -p "$DATA_DIR/bot-desktop"
if [[ "${1:-}" == '--run' ]]; then
  if [[ "${MYBOT_DESKTOP_PACKAGE:-}" == '1' && -n "${MYBOT_DESKTOP_UPDATE_LOCK:-}" ]]; then
    exec 8<"$MYBOT_DESKTOP_UPDATE_LOCK"
    # Hold a shared lock for the complete service lifetime. An installer holds
    # the exclusive lock; do not queue a browser launch to run after an update.
    flock -sn 8 || { echo 'Desktop update in progress. Start again after installation.' >&2; exit 0; }
  fi
  exec 9>"$DATA_DIR/bot-desktop/workstation.lock"
  flock -n 9 || { echo 'The workstation supervisor is already running.' >&2; exit 1; }
fi
exec node scripts/start-workstation.mjs "$@"
