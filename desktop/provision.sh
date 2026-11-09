#!/usr/bin/env bash
set -euo pipefail
[[ "$(id -u)" == '0' && "${WSL_DISTRO_NAME:-}" == 'MYBOT-Desktop-V1' ]] || { echo 'Use the dedicated MY-BOT distribution only.' >&2; exit 1; }
BUNDLE_DIR="${1:?Missing package directory}"
VNC_PORT="${2:?Missing VNC port}"
VIEWER_PORT="${3:?Missing viewer port}"
# Package integrity was checked by Windows before this script was invoked.
source /etc/os-release
[[ "$ID" == 'debian' && "${VERSION_ID%%.*}" -ge 13 ]] || { echo 'The packaged runtime requires Debian 13 or later.' >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
if ! command -v flock >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends util-linux
fi
install -d -m 0755 /opt/mybot-desktop
touch /opt/mybot-desktop/update.lock
chmod 0644 /opt/mybot-desktop/update.lock
exec 8>/opt/mybot-desktop/update.lock
flock -xn 8 || { echo 'Stop the Desktop service before updating. Runtime was not changed.' >&2; exit 1; }
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates chromium chromium-sandbox fonts-noto-core nodejs python3 xvfb xauth x11-utils x11-xserver-utils openbox tint2 pcmanfm xdg-utils x11vnc novnc websockify util-linux dbus-user-session libpam-systemd systemd systemd-sysv
python3 - "$BUNDLE_DIR" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
# utf-8-sig tolerates a Windows PowerShell BOM if the package metadata was rewritten locally.
package = json.loads((root / 'package.json').read_text(encoding='utf-8-sig'))
assert package['format'] == 1 and package['name'] == 'MY-BOT Desktop'
for item in package['files']:
    target = (root / item['path']).resolve()
    assert target.is_relative_to(root) and target.is_file()
    assert hashlib.sha256(target.read_bytes()).hexdigest() == item['sha256']
PY
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)'
if ! id mybot >/dev/null 2>&1; then useradd --create-home --shell /bin/bash mybot; fi
install -d -m 0700 -o mybot -g mybot /var/lib/mybot-desktop /var/lib/mybot-desktop/bot-desktop
install -d -m 0755 /opt/mybot-desktop/releases
[[ ! -e /etc/mybot-desktop-owner || "$(cat /etc/mybot-desktop-owner)" == 'MYBOT-Desktop-V1' ]] || exit 1
printf '%s\n' 'MYBOT-Desktop-V1' > /etc/mybot-desktop-owner
node --input-type=module - "$BUNDLE_DIR" "$VNC_PORT" "$VIEWER_PORT" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const bundle=process.argv[2], metadata=JSON.parse(fs.readFileSync(path.join(bundle,'package.json'),'utf8'));
const {desktopPorts}=await import(pathToFileURL(path.join(bundle,'runtime/scripts/lib/workstation.mjs')));
const ports=desktopPorts({vncPort:Number(process.argv[3]),viewerPort:Number(process.argv[4])});
if(!/^[a-f0-9]{24}$/.test(metadata.releaseId))throw Error('Invalid release');
const url=new URL(metadata.serverOrigin);
if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Invalid server');
// Write mutable per-user settings as that user, never follow their symlinks as root.
execFileSync('runuser',['-u','mybot','--',process.execPath,'--input-type=module','-e',`
  import fs from 'node:fs';
  const state='/var/lib/mybot-desktop/bot-desktop/workstation-config.json', origin=process.argv[1];
  if(fs.existsSync(state)&&JSON.parse(fs.readFileSync(state,'utf8')).serverOrigin!==origin)throw Error('Use the original server; pairing was not changed.');
  fs.writeFileSync(state,JSON.stringify({mode:'remote',serverOrigin:origin,vncPort:Number(process.argv[2]),viewerPort:Number(process.argv[3])}),{mode:0o600});
`,url.origin,String(ports.vncPort),String(ports.viewerPort)],{stdio:'inherit'});
const previous=fs.existsSync('/opt/mybot-desktop/current')?path.resolve(fs.readlinkSync('/opt/mybot-desktop/current')):'';
const {installDesktopRelease,switchDesktopCurrent,pruneDesktopReleases}=await import(pathToFileURL(path.join(bundle,'runtime/scripts/lib/desktop-release.mjs')));
// Stage then rename so a crashed copy never leaves a half-written release that later installs skip.
const {release}=installDesktopRelease({bundleRuntime:path.join(bundle,'runtime'),releasesDir:'/opt/mybot-desktop/releases',releaseId:metadata.releaseId});
switchDesktopCurrent('/opt/mybot-desktop/current',release);
// Stable public extension key keeps the identity across immutable release directories.
const {workstationUnit}=await import(pathToFileURL(path.join(release,'scripts/lib/workstation-service.mjs')));
const unitDir='/etc/systemd/user';fs.mkdirSync(unitDir,{recursive:true});
fs.writeFileSync(path.join(unitDir,'mybot-workstation.service'),workstationUnit('/opt/mybot-desktop/current','/usr/bin/node',{dataRoot:'/var/lib/mybot-desktop'}));
// Keep current + one previous completed release for manual rollback; prune incomplete/older trees.
pruneDesktopReleases('/opt/mybot-desktop/releases',[release, previous]);
JS
chmod -R go-w /opt/mybot-desktop/releases
# Launcher scripts must stay executable after the Windows-built ZIP lands in the release tree.
for script in focus-bot-browser.sh open-files.sh; do
  if [[ -f /opt/mybot-desktop/current/desktop/$script ]]; then
    chmod a+x /opt/mybot-desktop/current/desktop/$script
  fi
done
# Prefer the file manager over Chromium for folders inside the bot desktop.
install -d -m 0755 -o mybot -g mybot /home/mybot/.config
cat > /home/mybot/.config/mimeapps.list <<'MIME'
[Default Applications]
inode/directory=pcmanfm.desktop;
inode/mount-point=pcmanfm.desktop;
x-scheme-handler/file=pcmanfm.desktop;
MIME
chown mybot:mybot /home/mybot/.config/mimeapps.list
chmod 0644 /home/mybot/.config/mimeapps.list
cat > /etc/wsl.conf <<'CONF'
[boot]
systemd=true
[user]
default=mybot
CONF
# Applies only inside the new dedicated distribution, not the owner's existing WSL.
install -d -m 0755 /var/lib/systemd/linger
touch /var/lib/systemd/linger/mybot
printf '%s\n' 'PASS: dedicated collector runtime installed. No local web, database or AI worker installed.'
