import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, access, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { workstationUnit } from './lib/workstation-service.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const service = 'mybot-workstation.service';
const directory = path.join(os.homedir(), '.config/systemd/user');
const unit = path.join(directory, service);
try {
  if (process.platform !== 'linux') throw new Error('Run inside WSL/Linux.');
  const action = process.argv[2];
  if (!['--install', '--remove'].includes(action) || process.argv.length !== 3) throw new Error('Use --install or --remove.');
  // Validate the user bus before writing anything. Do not enable lingering or change OS services.
  execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' });
  if (action === '--install') {
    await access(path.join(root, '.next/BUILD_ID'));
    await access(path.join(root, 'data/bot-desktop/vnc-password'));
    await mkdir(directory, { recursive: true });
    await writeFile(unit, workstationUnit(root, process.execPath), { mode: 0o600 });
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    execFileSync('systemctl', ['--user', 'enable', '--now', service], { stdio: 'inherit' });
    console.log('Installed MY-BOT user service. Status: npm run bot:status. Service log: journalctl --user -u mybot-workstation.service.');
  } else {
    execFileSync('systemctl', ['--user', 'disable', '--now', service], { stdio: 'inherit' });
    await unlink(unit).catch(error => { if (error.code !== 'ENOENT') throw error; });
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
    console.log('Removed MY-BOT user service. Existing unmanaged services and browser profile were left unchanged.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
