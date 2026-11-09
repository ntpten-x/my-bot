#!/usr/bin/env bash
set -euo pipefail
# Keep a foreground wsl.exe request open. systemd alone does not guarantee that
# WSL stays alive after its last Windows client exits. Never restart Chrome here.
systemctl --user start mybot-workstation.service
while true; do
  STATE="$(systemctl --user show mybot-workstation.service --property=ActiveState --value)"
  case "$STATE" in
    active|activating|reloading|deactivating) sleep "${MYBOT_KEEPALIVE_INTERVAL:-5}" ;;
    inactive|failed) exit 0 ;;
    *) exit 1 ;;
  esac
done
