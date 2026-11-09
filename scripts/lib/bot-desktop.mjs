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
    viewer: `http://localhost:${viewerPort}/vnc.html?host=localhost&port=${viewerPort}&resize=scale`,
    xvfb: [display, '-screen', '0', '1600x900x24', '-nolisten', 'tcp', '-auth', auth],
    vnc: ['-display', display, '-auth', auth, '-localhost', '-rfbport', String(vncPort), '-rfbauth', password, '-forever', '-shared', '-norc'],
    proxy: ['--web', '/usr/share/novnc', `127.0.0.1:${viewerPort}`, `127.0.0.1:${vncPort}`],
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
