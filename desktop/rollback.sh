#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -u)" == '0' && "${WSL_DISTRO_NAME:-}" == 'MYBOT-Desktop-V1' ]] || { echo 'Use the dedicated MY-BOT distribution as root only.' >&2; exit 1; }
[[ -e /etc/mybot-desktop-owner && "$(cat /etc/mybot-desktop-owner)" == 'MYBOT-Desktop-V1' ]] || { echo 'Ownership marker missing; refuse rollback.' >&2; exit 1; }
install -d -m 0755 /opt/mybot-desktop
touch /opt/mybot-desktop/update.lock
chmod 0644 /opt/mybot-desktop/update.lock
exec 8>/opt/mybot-desktop/update.lock
flock -xn 8 || { echo 'Stop the Desktop service before rollback. Runtime was not changed.' >&2; exit 1; }
if id mybot >/dev/null 2>&1; then
  if runuser -u mybot -- bash -lc 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user is-active --quiet mybot-workstation.service' 2>/dev/null; then
    echo 'Stop the Desktop service before rollback.' >&2
    exit 1
  fi
fi
node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const currentLink = '/opt/mybot-desktop/current';
const releasesDir = '/opt/mybot-desktop/releases';
if (!fs.existsSync(currentLink)) throw new Error('No current release to roll back from');
const current = path.resolve(fs.readlinkSync(currentLink));
const { listCompletedReleases, switchDesktopCurrent, RELEASE_COMPLETE } = await import(pathToFileURL(path.join(current, 'scripts/lib/desktop-release.mjs')));
const completed = listCompletedReleases(releasesDir).filter((target) => target !== current);
if (!completed.length) throw new Error('No previous completed release available');
const previous = completed.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
if (!fs.existsSync(path.join(previous, RELEASE_COMPLETE))) throw new Error('Previous release is incomplete');
switchDesktopCurrent(currentLink, previous);
const { workstationUnit } = await import(pathToFileURL(path.join(previous, 'scripts/lib/workstation-service.mjs')));
const unitDir = '/etc/systemd/user';
fs.mkdirSync(unitDir, { recursive: true });
fs.writeFileSync(path.join(unitDir, 'mybot-workstation.service'), workstationUnit('/opt/mybot-desktop/current', '/usr/bin/node', { dataRoot: '/var/lib/mybot-desktop' }));
console.log('PASS: rolled back to ' + path.basename(previous));
JS
