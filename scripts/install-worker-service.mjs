// Explicit opt-in for a machine whose cloud worker is unavailable.
import { execFileSync } from 'node:child_process';
import { access, mkdir, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const name = 'mybot-worker.service';
const directory = path.join(os.homedir(), '.config/systemd/user');
const unit = path.join(directory, name);
const quote = value => {
  if (/[\r\n\0]/.test(value)) throw new Error('Invalid service path');
  return `"${value.replace(/%/g, '%%').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};
try {
  const action = process.argv[2];
  if (/[\r\n\0]/.test(root)) throw new Error('Invalid service path');
  if (process.platform !== 'linux' || process.argv.length !== 3 || !['--install', '--remove'].includes(action)) throw new Error('Use --install or --remove inside Linux/WSL');
  execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' });
  if (action === '--install') {
    await access(path.join(root, '.env'));
    await access(path.join(root, 'node_modules/tsx/dist/cli.mjs'));
    await mkdir(directory, { recursive: true });
    await writeFile(unit, `[Unit]\nDescription=MY-BOT opt-in leased worker\nStartLimitIntervalSec=300\nStartLimitBurst=5\n\n[Service]\nType=simple\nWorkingDirectory=${root.replace(/%/g, '%%')}\nEnvironment=NODE_ENV=production\nEnvironment=MYBOT_PROCESS=worker\nEnvironment=${quote(`PATH=${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`)}\nExecStart=${quote(process.execPath)} ${quote(path.join(root, 'node_modules/tsx/dist/cli.mjs'))} ${quote(path.join(root, 'src/worker/index.ts'))}\nRestart=on-failure\nRestartSec=15\nTimeoutStopSec=30\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`, { mode: 0o600 });
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'enable', '--now', name], { stdio: 'inherit' });
    console.log('Installed opt-in MY-BOT worker. The database lease prevents concurrent leaders. Comment Start and consent remain separate.');
  } else {
    execFileSync('systemctl', ['--user', 'disable', '--now', name], { stdio: 'inherit' });
    await unlink(unit).catch(error => { if (error.code !== 'ENOENT') throw error; });
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    console.log('Removed MY-BOT worker service. Browser and web were left running.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
