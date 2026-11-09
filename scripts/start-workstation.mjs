import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { open, readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopAction, desktopPorts, portOpen, webReady, viewerReady, restartDelay, workstationConfig, WORKSTATION_INTERVAL_MS } from './lib/workstation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = process.env.MYBOT_DATA_ROOT || path.join(root, 'data');
const runtime = path.join(dataRoot, 'bot-desktop');
const statusFile = path.join(runtime, 'workstation.json');
const requestFile = path.join(runtime, 'workstation-request.json');
const args = process.argv.slice(2);
const readJson = async file => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
async function saveJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
const fresh = state => state && Date.now() - Date.parse(state.at) >= 0 && Date.now() - Date.parse(state.at) < 60_000 && !['stopped', 'stopping'].includes(state.phase);
const log = message => console.log(`${new Date().toISOString()} ${message}`);

async function main() {
  if (args.length !== 1 || !['--start', '--run', '--status', '--stop', '--resume-desktop', '--help'].includes(args[0])) {
    console.log('npm run bot:start | bot:status | bot:stop\nnpm run bot:resume-desktop (owner review before reopening Chrome)\nWSL/Linux only; starts web and the existing bot desktop profile, never a local worker.');
    if (args[0] !== '--help') process.exitCode = 1;
    return;
  }
  if (args[0] === '--help') { console.log('npm run bot:start | bot:status | bot:stop | bot:resume-desktop\nWeb + isolated desktop; worker stays on its current host.'); return; }
  if (process.platform !== 'linux') throw new Error('Run this command inside WSL/Linux.');
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await chmod(runtime, 0o700);
  let config = null;
  try { config = JSON.parse(await readFile(path.join(runtime, 'workstation-config.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid workstation configuration.'); }
  config = workstationConfig(config);
  const ports = desktopPorts(config);
  if (process.env.MYBOT_DESKTOP_PACKAGE === '1' && config.mode !== 'remote') throw new Error('Desktop production configuration is missing. Local services were not started.');
  const current = await readJson(statusFile);
  if (args[0] === '--status') {
    console.log(JSON.stringify({ supervisor: fresh(current) ? current : { phase: 'not-running', lastStatus: current },
      mode: config.mode, serverOrigin: config.serverOrigin, ...ports,
      webReady: await webReady(fetch, config.serverOrigin), vncListening: await portOpen(ports.vncPort), viewerReady: await viewerReady(fetch, ports.viewerPort) }, null, 2));
    return;
  }
  if (['--stop', '--resume-desktop'].includes(args[0])) {
    if (!fresh(current)) throw new Error('The workstation supervisor is not running.');
    await saveJson(requestFile, { session: current.session, action: args[0].slice(2), nonce: randomUUID() });
    console.log('Request saved. The supervisor checks it within 15 seconds. Existing unmanaged services are left running.');
    return;
  }
  if (args[0] === '--start') {
    if (fresh(current)) { console.log('Workstation supervisor is already running. Use npm run bot:status.'); return; }
    if (existsSync(path.join(os.homedir(), '.config/systemd/user/mybot-workstation.service'))) {
      execFileSync('systemctl', ['--user', 'start', 'mybot-workstation.service'], { stdio: 'inherit' });
      console.log('Started MY-BOT user service. Use npm run bot:status.');
      return;
    }
    const output = await open(path.join(dataRoot, 'workstation.log'), 'a', 0o600);
    let child;
    try {
      child = spawn('bash', [path.join(root, 'scripts/start-workstation.sh'), '--run'], {
        cwd: root, detached: true, stdio: ['ignore', output.fd, output.fd], shell: false,
        env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` },
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } finally { await output.close(); }
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (fresh(await readJson(statusFile))) { console.log('Workstation supervisor started. Use npm run bot:status. Log: data/workstation.log'); return; }
    }
    throw new Error('Supervisor did not become ready. Inspect data/workstation.log.');
  }
  const state = { session: randomUUID(), phase: 'starting', at: new Date().toISOString(),
    web: 'checking', desktop: 'checking', webRestarts: 0, desktopRestarts: 0, mode: config.mode, serverOrigin: config.serverOrigin, ...ports };
  let stopping = false, firstCheck = true, desktopAttempted = false, webChild = null, desktopChild = null;
  let webFailures = 0, webRetryAt = 0, desktopExited = false, lastRequest = '';
  let webUnhealthy = 0, webStartedAt = 0, webTerminating = false;
  const children = new Set();
  const persist = async () => { state.at = new Date().toISOString(); await saveJson(statusFile, state); };
  const start = (name, executable, childArgs, onExit) => {
    if (stopping) return null;
    const child = spawn(executable, childArgs, { cwd: root, detached: true, stdio: ['ignore', 'inherit', 'inherit'], shell: false });
    children.add(child);
    let finished = false;
    const done = () => { if (finished) return; finished = true; children.delete(child); if (!stopping) onExit(); };
    child.once('error', done); child.once('exit', done);
    log(`${name}: started`);
    return child;
  };
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    log('Stopping only services owned by this supervisor.');
    for (const child of children) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    const timer = setTimeout(() => {
      for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    }, 12_000);
    timer.unref();
  };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  await persist();
  try {
    while (!stopping) {
      const request = await readJson(requestFile);
      const requestText = JSON.stringify(request);
      if (request?.session === state.session && requestText !== lastRequest) {
        lastRequest = requestText;
        if (request.action === 'stop') { shutdown(); break; }
        if (request.action === 'resume-desktop' && !desktopChild) {
          firstCheck = true; desktopAttempted = false; desktopExited = false;
          state.desktopRestarts++;
        }
      }
      const healthy = await webReady(fetch, config.serverOrigin);
      state.web = healthy ? (config.mode === 'remote' ? 'remote' : webChild ? 'running' : 'existing') : 'unavailable';
      if (healthy) { webFailures = 0; webUnhealthy = 0; }
      else if (webChild && Date.now() - webStartedAt > 60_000 && !webTerminating) {
        webUnhealthy++;
        if (webUnhealthy >= 3) {
          webTerminating = true;
          log('Owned web failed three health checks after startup grace; restarting web only.');
          const unhealthyChild = webChild;
          try { process.kill(-unhealthyChild.pid, 'SIGTERM'); } catch {}
          const timeout = setTimeout(() => {
            if (children.has(unhealthyChild)) { try { process.kill(-unhealthyChild.pid, 'SIGKILL'); } catch {} }
          }, 10_000);
          timeout.unref();
        }
      }
      if (config.mode === 'local' && !healthy && !webChild && Date.now() >= webRetryAt) {
        if (await portOpen(8001)) state.web = 'port-busy-review';
        else {
          webChild = start('Web (no local worker)', process.execPath,
            ['node_modules/next/dist/bin/next', 'start', '-p', '8001'], () => {
              webChild = null; webFailures++; state.webRestarts++;
              webTerminating = false; webUnhealthy = 0;
              webRetryAt = Date.now() + restartDelay(webFailures);
              log('Web exited; scheduled retry.');
            });
          webStartedAt = Date.now();
          state.web = 'starting';
        }
      }
      const vnc = await portOpen(ports.vncPort), viewer = await viewerReady(fetch, ports.viewerPort);
      const action = desktopExited ? 'review' : desktopAction({ firstCheck, vnc, viewer, attempted: desktopAttempted, allowExisting: process.env.MYBOT_DESKTOP_PACKAGE !== '1' });
      if (action === 'start') {
        desktopAttempted = true;
        desktopChild = start('Isolated desktop', 'bash', ['scripts/start-bot-desktop.sh', '--url', config.serverOrigin], () => {
          desktopChild = null; desktopExited = true;
          log('Desktop stopped. Review Facebook/comment history, then run npm run bot:resume-desktop. No automatic Chrome restart.');
        });
        state.desktop = 'starting';
      } else state.desktop = action === 'ready' ? (desktopChild ? 'running' : 'existing') : action === 'review' ? 'needs-review' : action === 'conflict' ? 'port-conflict-review' : 'partial-review';
      const details = await readJson(path.join(runtime, 'components.json'));
      state.desktopComponents = desktopChild && details ? details : null;
      firstCheck = false;
      state.phase = ['running', 'existing', 'remote'].includes(state.web) && ['running', 'existing'].includes(state.desktop) ? 'running' : 'needs-attention';
      if (state.desktopComponents?.phase === 'degraded') state.phase = 'needs-attention';
      await persist();
      for (let step = 0; step < WORKSTATION_INTERVAL_MS / 250 && !stopping; step++) await new Promise(resolve => setTimeout(resolve, 250));
    }
  } finally {
    shutdown(); state.phase = 'stopping'; await persist();
    const deadline = Date.now() + 14_000;
    while (children.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    state.phase = 'stopped'; await persist();
  }
}
main().catch(error => { console.error(`Workstation command failed: ${error.message}. Check data/workstation.log or the user-service journal.`); process.exitCode = 1; });
