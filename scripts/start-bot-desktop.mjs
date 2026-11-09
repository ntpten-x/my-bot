import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, chmod, mkdir, stat, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopPlan, desktopEnvironment } from './lib/bot-desktop.mjs';
import { findBrowser } from './lib/bot-browser.mjs';
import { profileInUse } from './lib/browser-profile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = process.env.MYBOT_DATA_ROOT || path.join(root, 'data');
const children = [];
let stopping = false;
const recoveryTimers = new Set();
const componentState = {};
let stateWrite = Promise.resolve();
function recordComponent(name, phase) {
  componentState[name] = phase;
  const state = JSON.stringify({ at: new Date().toISOString(), phase: Object.values(componentState).some(value => ['review', 'recovering'].includes(value)) ? 'degraded' : 'running', components: componentState });
  stateWrite = stateWrite.catch(() => undefined).then(() => writeFile(path.join(dataRoot, 'bot-desktop/components.json'), state, { mode: 0o600 })).catch(() => undefined);
}
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const timer of recoveryTimers) clearTimeout(timer);
  // Signal only process groups created by this supervisor; no PID files or global pkill.
  for (const child of [...children].reverse()) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
  process.exitCode = code;
  // Keep the flock until every child has exited. Never reopen an ambiguous browser session.
  const timer = setTimeout(() => {
    for (const child of children) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  }, 8000);
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? null : new Promise(resolve => child.once('exit', resolve))))
    .then(() => clearTimeout(timer));
}
function start(name, executable, args, env, failures = 0) {
  if (stopping) throw new Error('The desktop is stopping.');
  const child = spawn(executable, args, { cwd: root, env, detached: true, stdio: name === 'Browser' ? 'ignore' : ['ignore', 'ignore', 'pipe'], shell: false });
  const startedAt = Date.now();
  // Do not log browser output or authority/profile contents.
  child.stderr?.resume();
  children.push(child);
  recordComponent(name, 'running');
  let finished = false;
  const exited = () => {
    if (finished) return;
    finished = true;
    const index = children.indexOf(child);
    if (index >= 0) children.splice(index, 1);
    if (stopping) return;
    // Viewer/window manager recovery does not recreate Chrome or touch its journal.
    if (['Desktop viewer', 'Web viewer', 'Window manager'].includes(name)) {
      const attempts = Date.now() - startedAt > 60_000 ? 1 : failures + 1;
      recordComponent(name, attempts > 5 ? 'review' : 'recovering');
      if (attempts > 5) { console.error(`${name} needs owner review after 5 retries. Chrome was left running.`); return; }
      const delay = Math.min(60_000, 1000 * 2 ** (attempts - 1));
      console.error(`${name} stopped; retrying in ${delay / 1000}s without restarting Chrome.`);
      const timer = setTimeout(() => { recoveryTimers.delete(timer); if (!stopping) start(name, executable, args, env, attempts); }, delay);
      recoveryTimers.add(timer);
    } else {
      recordComponent(name, 'review');
      console.error(`${name} stopped. Inspect the session before restarting; uncertain sends are not retried.`);
      shutdown(1);
    }
  };
  child.once('error', exited);
  child.once('exit', exited);
  return child;
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(test, label) {
  for (let i = 0; i < 80 && !stopping; i++) { if (await test()) return; await sleep(250); }
  throw new Error(`${label} did not become ready.`);
}
async function isListening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => { socket.destroy(); resolve(false); });
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}
try {
  let url, check = false, passwordSetup = false, passwordWindow = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') {
      console.log('npm run browser:desktop -- [--check | --password | --password-window] [--url https://app.example]\nLinux/WSL only. Starts an authenticated virtual desktop; keep this process running. Viewer: http://localhost:6085/vnc.html\nFirst install: sudo apt-get install --no-install-recommends chromium chromium-sandbox xvfb xauth x11-utils x11-xserver-utils openbox x11vnc novnc websockify util-linux\nSet the viewer password locally using --password. Never send that password in chat.');
      process.exit(0);
    }
    if (args[i] === '--check') { check = true; continue; }
    if (args[i] === '--password-window') { passwordWindow = true; continue; }
    if (args[i] === '--password') { passwordSetup = true; continue; }
    if (args[i] === '--url' && args[i + 1]) { url = args[++i]; continue; }
    throw new Error('Unknown or incomplete option. Use --help.');
  }
  if (process.platform !== 'linux') throw new Error('Run this command inside WSL/Linux, not Windows Node.js.');
  const plan = desktopPlan(root, url, { dataRoot,
    extensionPath: process.env.MYBOT_DESKTOP_PACKAGE === '1' ? path.join(root, 'extension') : undefined });
  const missing = [];
  for (const name of ['Xvfb', 'xauth', 'xdpyinfo', 'xset', 'openbox', 'x11vnc', 'websockify', 'flock']) {
    const found = await Promise.all((process.env.PATH || '').split(path.delimiter).filter(Boolean)
      .map(dir => access(path.join(dir, name), constants.X_OK).then(() => true, () => false)));
    if (!found.some(Boolean)) missing.push(name);
  }
  const browser = await findBrowser('linux', process.env, process.env.MYBOT_CHROME_PATH);
  if (!browser) missing.push('Chrome/Chromium');
  try { await access('/usr/share/novnc/vnc.html'); } catch { missing.push('noVNC web files'); }
  let passwordOk = false;
  try { const info = await stat(plan.password); passwordOk = info.isFile() && info.size > 0 && !(info.mode & 0o077); } catch {}
  if (check) {
    console.log(`Desktop dependencies: ${missing.length ? `MISSING: ${missing.join(', ')}` : 'PASS'}`);
    console.log(`Local viewer password: ${passwordOk ? 'PASS' : 'MISSING or insecure permissions; run --password'}`);
    let viewerReady = false;
    if (await isListening(5905)) {
      try { viewerReady = (await fetch('http://127.0.0.1:6085/vnc.html', { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(1500) })).ok; } catch {}
    }
    console.log(`Desktop service: ${viewerReady ? `RUNNING: ${plan.viewer}` : 'NOT RUNNING: run npm run browser:desktop after password setup'}`);
    console.log('App/database/pairing/Facebook login and real feed progress require separate checks.');
    if (missing.length || !passwordOk || !viewerReady) process.exitCode = 1;
  } else {
    if (missing.length) throw new Error(`Missing: ${missing.join(', ')}. Run --help for the install command.`);
    await mkdir(plan.runtime, { recursive: true, mode: 0o700 });
    await chmod(plan.runtime, 0o700);
    if (passwordWindow) {
      if (!process.env.WSL_DISTRO_NAME) throw new Error('--password-window requires WSL. Use --password in a Linux terminal.');
      const requestDir = await mkdtemp(path.join(plan.runtime, 'password-request-'));
      try {
        const input = path.join(requestDir, 'input');
        await writeFile(input, '', { mode: 0o600, flag: 'wx' });
        const windowsPath = target => execFileSync('wslpath', ['-w', target], { encoding: 'utf8' }).trim();
        const child = spawn('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', windowsPath(path.join(root, 'scripts/windows/set-bot-viewer-password.ps1')), '-SecretPath', windowsPath(input)], { stdio: 'inherit', shell: false });
        const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
        if (code !== 0) throw new Error('Windows password setup did not finish; the desktop was not started.');
        const secret = await readFile(input);
        try {
          const store = spawn('python3', [path.join(root, 'scripts/store-vnc-password.py'), plan.password], { stdio: ['pipe', 'inherit', 'inherit'], shell: false });
          const saved = new Promise((resolve, reject) => { store.once('exit', resolve); store.once('error', reject); });
          store.stdin.on('error', () => undefined);
          store.stdin.end(secret);
          if (await saved !== 0) throw new Error('Could not save the local viewer password.');
        } finally { secret.fill(0); }
      } finally { await rm(requestDir, { recursive: true, force: true }); }
    } else if (passwordSetup) {
      const child = spawn('x11vnc', ['-storepasswd', plan.password], { stdio: 'inherit', shell: false });
      const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
      if (code !== 0) throw new Error('Password setup did not finish.');
      await chmod(plan.password, 0o600);
    } else {
      if (!passwordOk) throw new Error('Set the viewer password locally first: npm run browser:desktop -- --password');
      for (const port of [5905, 6085]) if (await isListening(port)) throw new Error(`Port ${port} is already in use; no existing process was changed.`);
      try { await access('/tmp/.X11-unix/X93'); throw new Error('Display :93 already exists; no existing display was changed.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (await profileInUse(path.join(plan.profile, 'SingletonLock'))) throw new Error('The desktop browser profile is already open. Close that profile first.');
      await mkdir(plan.profile, { recursive: true, mode: 0o700 });
      const env = desktopEnvironment(process.env, plan);
      try {
        execFileSync('xauth', ['-f', plan.auth, 'add', plan.display, '.', randomBytes(16).toString('hex')], { env, stdio: 'ignore' });
      } catch { throw new Error('Could not initialize the private X authority.'); }
      await chmod(plan.auth, 0o600);
      process.on('SIGINT', () => shutdown(0)); process.on('SIGTERM', () => shutdown(0));
      start('Virtual display', 'Xvfb', plan.xvfb, env);
      await waitFor(async () => { try { execFileSync('xdpyinfo', ['-display', plan.display], { env, stdio: 'ignore', timeout: 1000 }); return true; } catch { return false; } }, 'Virtual display');
      execFileSync('xset', ['s', 'off'], { env, stdio: 'ignore' });
      execFileSync('xset', ['-dpms'], { env, stdio: 'ignore' });
      start('Window manager', 'openbox', [], env);
      await sleep(750);
      if (stopping) throw new Error('Window manager stopped before startup.');
      start('Desktop viewer', 'x11vnc', plan.vnc, env);
      await waitFor(() => isListening(5905), 'Desktop viewer');
      start('Web viewer', 'websockify', plan.proxy, env);
      await waitFor(() => isListening(6085), 'Web viewer');
      start('Browser', browser, plan.chrome, env);
      console.log(`Bot desktop started. Open ${plan.viewer} and enter your local viewer password.`);
      console.log('Keep this WSL process running. You may close/minimize the viewer; do not minimize Chrome inside it. No automation settings were changed.');
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'The bot desktop could not start.');
  shutdown(1);
}
