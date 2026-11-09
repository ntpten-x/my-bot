#!/usr/bin/env bash
set -euo pipefail
[[ "${WSL_DISTRO_NAME:-}" == 'MYBOT-Desktop-V1' && "$(id -un)" == 'mybot' ]] || exit 1
export MYBOT_DATA_ROOT=/var/lib/mybot-desktop
export MYBOT_DESKTOP_PACKAGE=1
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
cd /opt/mybot-desktop/current
case "${1:-}" in
  password)
    if [[ -s "$MYBOT_DATA_ROOT/bot-desktop/vnc-password" ]]; then exit 0; fi
    exec node scripts/start-bot-desktop.mjs --password-window
    ;;
  start|stop|status|resume|disable|keepalive)
    for attempt in {1..40}; do
      [[ -S "$XDG_RUNTIME_DIR/bus" ]] && break
      sleep 0.25
    done
    case "$1" in
      start)
        flock -sn /opt/mybot-desktop/update.lock -c true || { echo 'An update is in progress.' >&2; exit 1; }
        systemctl --user start mybot-workstation.service
        ;;
      keepalive)
        flock -sn /opt/mybot-desktop/update.lock -c true || { echo 'An update is in progress.' >&2; exit 1; }
        exec bash desktop/keepalive.sh
        ;;
      stop) systemctl --user stop mybot-workstation.service ;;
      disable) systemctl --user disable --now mybot-workstation.service ;;
      resume) node scripts/start-workstation.mjs --resume-desktop ;;
      status) node scripts/start-workstation.mjs --status ;;
    esac
    ;;
  *) echo 'Unknown desktop action.' >&2; exit 1 ;;
esac
