import { mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { posix as path } from 'node:path';
import { browserPlan } from './bot-browser.mjs';
import { desktopPorts } from './workstation.mjs';

export function desktopPlan(root, url = 'http://localhost:8001', options = {}) {
  const dataRoot = options.dataRoot || path.join(root, 'data');
  const { vncPort, viewerPort } = desktopPorts(options);
  if (!path.isAbsolute(dataRoot)) throw new Error('The desktop data directory must be absolute.');
  const runtime = path.join(dataRoot, 'bot-desktop');
  // Keep the legacy display, but isolate optional Desktop instances as well as
  // their TCP listeners when WSL distributions share abstract X socket space.
  const display = viewerPort === 6085 ? ':93' : `:${viewerPort}`;
  const auth = path.join(runtime, 'Xauthority');
  const password = path.join(runtime, 'vnc-password');
  const profile = path.join(dataRoot, 'desktop-browser-profile');
  const app = browserPlan({ root, url, platform: 'linux', env: { DISPLAY: display } });
  return {
    runtime, display, auth, password, profile, origin: app.origin, vncPort, viewerPort,
    viewer: `http://localhost:${viewerPort}/vnc.html?host=localhost&port=${viewerPort}&resize=scale&reconnect=1&reconnect_delay=3000&quality=6&compression=2`,
    xvfb: [display, '-screen', '0', '1600x900x24', '-nolisten', 'tcp', '-auth', auth],
    vnc: ['-display', display, '-auth', auth, '-localhost', '-rfbport', String(vncPort), '-rfbauth', password, '-forever', '-shared', '-norc'],
    proxy: ['--web', path.join(runtime, 'viewer-public'), `127.0.0.1:${viewerPort}`, `127.0.0.1:${vncPort}`],
    chrome: [`--user-data-dir=${profile}`, '--ozone-platform=x11',
      ...(options.extensionPath ? [`--load-extension=${options.extensionPath}`] : []),
      ...app.args.filter(arg => !arg.startsWith('--user-data-dir='))],
    env: { DISPLAY: display, XAUTHORITY: auth, XDG_SESSION_TYPE: 'x11', GDK_BACKEND: 'x11' },
  };
}

// WSLg sets Wayland variables; an empty string still counts as present to x11vnc.
export function desktopEnvironment(parent, plan) {
  const env = { ...parent, ...plan.env };
  delete env.WAYLAND_DISPLAY;
  delete env.WAYLAND_SOCKET;
  return env;
}

// Serve only public assets, never the runtime directory containing X/VNC authority.
export async function prepareViewer(root, plan, vendorRoot = '/usr/share/novnc') {
  const directory = path.join(plan.runtime, 'viewer-public');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const name of ['app', 'core', 'vendor']) {
    const target = path.join(directory, name);
    try { await symlink(path.join(vendorRoot, name), target); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  let html = await readFile(path.join(vendorRoot, 'vnc.html'), 'utf8');
  const marker = 'import UI from "./app/ui.js";';
  if (!html.includes(marker)) throw new Error('Unsupported noVNC UI; viewer enhancements require the packaged UI module.');
  html = html.replace(marker, marker + '\nimport { installViewer } from "./viewer-enhancements.mjs";\ninstallViewer(UI);');
  await writeFile(path.join(directory, 'vnc.html'), html, { mode: 0o600 });
  for (const name of ['viewer-enhancements.mjs', 'viewer-policy.mjs']) {
    await writeFile(path.join(directory, name), await readFile(path.join(root, 'desktop', name)), { mode: 0o600 });
  }
  await writeFile(path.join(directory, 'defaults.json'), JSON.stringify({ reconnect: true, reconnect_delay: 3000, quality: 6, compression: 2 }), { mode: 0o600 });
  await writeFile(path.join(directory, 'mandatory.json'), JSON.stringify({ host: 'localhost', port: String(plan.viewerPort), path: 'websockify', encrypt: false, resize: 'scale' }), { mode: 0o600 });
  return directory;
}
