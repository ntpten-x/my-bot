import path from 'node:path';

const quote = value => {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid service path.');
  return `"${value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

export function workstationUnit(root, node, options = {}) {
  if (!path.isAbsolute(root) || !path.isAbsolute(node) || /[\r\n\0\\]/.test(root)) throw new Error('Invalid service path.');
  // WorkingDirectory is a single path setting, not a shell-style quoted word.
  // Always emit POSIX paths: this unit runs inside Linux/WSL even when packaged on Windows.
  const directory = root.replace(/%/g, '%%');
  const nodeDir = path.posix.dirname(node.replace(/\\/g, '/'));
  const startScript = path.posix.join(root.replace(/\\/g, '/'), 'scripts/start-workstation.sh');
  const extra = options.dataRoot ? `Environment=${quote(`MYBOT_DATA_ROOT=${options.dataRoot}`)}\nEnvironment=MYBOT_DESKTOP_PACKAGE=1\nEnvironment=MYBOT_DESKTOP_UPDATE_LOCK=/opt/mybot-desktop/update.lock\n` : '';
  return `[Unit]\nDescription=MY-BOT web and isolated browser desktop\nStartLimitIntervalSec=300\nStartLimitBurst=3\n\n[Service]\nType=simple\nWorkingDirectory=${directory}\nEnvironment=${quote(`PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin`)}\nEnvironment=NODE_ENV=production\n${extra}ExecStart=/bin/bash ${quote(startScript)} --run\nRestart=on-failure\nRestartSec=15\nTimeoutStopSec=25\nKillMode=mixed\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
}
