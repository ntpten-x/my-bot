import path from 'node:path';
import { browserPlan } from './bot-browser.mjs';

export function desktopPlan(root, url = 'http://localhost:8001') {
  const runtime = path.join(root, 'data', 'bot-desktop');
  const display = ':93';
  const auth = path.join(runtime, 'Xauthority');
  const password = path.join(runtime, 'vnc-password');
  const profile = path.join(root, 'data', 'desktop-browser-profile');
  const app = browserPlan({ root, url, platform: 'linux', env: { DISPLAY: display } });
  return {
    runtime, display, auth, password, profile, origin: app.origin,
    viewer: 'http://localhost:6085/vnc.html?host=localhost&port=6085&resize=scale',
    xvfb: [display, '-screen', '0', '1600x900x24', '-nolisten', 'tcp', '-auth', auth],
    vnc: ['-display', display, '-auth', auth, '-localhost', '-rfbport', '5905', '-rfbauth', password, '-forever', '-shared', '-norc'],
    proxy: ['--web', '/usr/share/novnc', '127.0.0.1:6085', '127.0.0.1:5905'],
    chrome: [`--user-data-dir=${profile}`, '--ozone-platform=x11', ...app.args.filter(arg => !arg.startsWith('--user-data-dir='))],
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
