import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const linuxOnly = process.platform === 'win32' ? it.skip : it;
linuxOnly('does not queue a browser launch when the installer owns the exclusive update lock', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mybot-desktop-update-'));
  const lock = path.join(root, 'update.lock'); writeFileSync(lock, '');
  const holder = spawn('flock', ['-x', lock, process.execPath, '-e', "process.stdout.write('locked');setTimeout(()=>{},10000)"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise((resolve, reject) => { holder.stdout!.once('data', resolve); holder.once('error', reject); });
    const output = execFileSync('bash', ['scripts/start-workstation.sh', '--run'], { encoding: 'utf8', timeout: 3000,
      env: { ...process.env, MYBOT_DATA_ROOT: root, MYBOT_DESKTOP_PACKAGE: '1', MYBOT_DESKTOP_UPDATE_LOCK: lock } });
    expect(output).not.toContain('started');
    expect(existsSync(path.join(root, 'bot-desktop/workstation.json'))).toBe(false);
  } finally {
    const exited = new Promise(resolve => holder.once('exit', resolve));
    try { process.kill(-holder.pid!, 'SIGTERM'); } catch {}
    await exited; rmSync(root, { recursive: true, force: true });
  }
});
linuxOnly('fails closed when a production Desktop package loses its remote configuration', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mybot-desktop-config-'));
  try {
    mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
    copyFileSync('scripts/start-workstation.mjs', path.join(root, 'scripts/start-workstation.mjs'));
    copyFileSync('scripts/lib/workstation.mjs', path.join(root, 'scripts/lib/workstation.mjs'));
    try {
      execFileSync(process.execPath, [path.join(root, 'scripts/start-workstation.mjs'), '--run'], {
        cwd: root, env: { PATH: process.env.PATH, HOME: root, MYBOT_DESKTOP_PACKAGE: '1' }, stdio: 'pipe', timeout: 5000,
      });
      throw Error('Supervisor must reject missing remote config');
    } catch (error) {
      const details = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
      const text = [details.stderr, details.stdout, details.message].map(value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '')).join('\n');
      expect(text).toContain('Desktop production configuration is missing');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
linuxOnly('runs the real supervisor in remote mode, never starts local web, and latches desktop failure', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mybot-desktop-runtime-'));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
    mkdirSync(path.join(root, 'data/bot-desktop'), { recursive: true });
    copyFileSync('scripts/start-workstation.mjs', path.join(root, 'scripts/start-workstation.mjs'));
    const actualModule = new URL(`file://${path.resolve('scripts/lib/workstation.mjs')}`).href;
    writeFileSync(path.join(root, 'scripts/lib/workstation.mjs'), `
      export {desktopAction, desktopComponentsReady, desktopPorts, restartDelay, workstationConfig} from ${JSON.stringify(actualModule)};
      export const WORKSTATION_INTERVAL_MS=250;
      export const webReady=async()=>false, portOpen=async()=>false, viewerReady=async()=>false;
    `);
    writeFileSync(path.join(root, 'scripts/start-bot-desktop.sh'), 'exit 1\n');
    writeFileSync(path.join(root, 'data/bot-desktop/workstation-config.json'), JSON.stringify({ mode: 'remote', serverOrigin: 'https://owner.example' }));
    child = spawn(process.execPath, [path.join(root, 'scripts/start-workstation.mjs'), '--run'], { cwd: root, env: { PATH: process.env.PATH, HOME: root }, stdio: 'ignore' });
    let state: { desktop: string; mode: string; webRestarts: number; desktopRestarts: number } | null = null;
    for (let i = 0; i < 80; i++) {
      await delay(50);
      try { state = JSON.parse(readFileSync(path.join(root, 'data/bot-desktop/workstation.json'), 'utf8')); } catch {}
      if (state?.desktop === 'needs-review') break;
    }
    expect(state).toMatchObject({ mode: 'remote', desktop: 'needs-review', webRestarts: 0, desktopRestarts: 0 });
    await delay(600);
    const next = JSON.parse(readFileSync(path.join(root, 'data/bot-desktop/workstation.json'), 'utf8'));
    expect(next.webRestarts).toBe(0);
    expect(next.desktop).toBe('needs-review');
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child!.once('exit', resolve));
      child.kill('SIGTERM'); await exited;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

it('validates remote mode before starting anything and separates persistent data from code', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {workstationConfig} from './scripts/lib/workstation.mjs';
    import {desktopPlan} from './scripts/lib/bot-desktop.mjs';
    const rejected=['http://remote.example','https://user:pass@remote.example','https://remote.example/a','https://remote.example?token=x','https://localhost'].map(serverOrigin=>{try{workstationConfig({mode:'remote',serverOrigin});return false}catch{return true}});
    console.log(JSON.stringify({rejected, config:workstationConfig({mode:'remote',serverOrigin:'https://owner.example'}),
      plan:desktopPlan('/opt/release','https://owner.example',{dataRoot:'/var/lib/mybot-desktop',extensionPath:'/opt/release/extension'})}));
  `], { encoding: 'utf8' }));
  expect(result.rejected).toEqual([true, true, true, true, true]);
  expect(result.config).toEqual({ mode: 'remote', serverOrigin: 'https://owner.example' });
  expect(result.plan.profile).toBe('/var/lib/mybot-desktop/desktop-browser-profile');
  expect(result.plan.chrome).toContain('--load-extension=/opt/release/extension');
  expect(result.plan.chrome).not.toContain('--no-sandbox');
});
