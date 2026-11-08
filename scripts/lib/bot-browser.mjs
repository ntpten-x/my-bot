import path from 'node:path';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

export function browserCandidates(platform, env = process.env) {
  if (platform === 'win32') return [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]
    .filter(Boolean).map(root => path.win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  if (platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
    .flatMap(name => (env.PATH || '/usr/bin:/usr/local/bin').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, name)));
}

export async function findBrowser(platform, env, explicit) {
  for (const candidate of explicit ? [explicit] : browserCandidates(platform, env)) {
    try { await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK); return candidate; } catch { /* Try the next standard installation. */ }
  }
  return null;
}

export function browserPlan({ root, url = 'http://localhost:8001', platform = process.platform, env = process.env }) {
  const target = new URL(url);
  if (target.username || target.password || target.search || target.hash) throw new Error('Use an app URL without credentials, query parameters or fragments.');
  if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) {
    throw new Error('Use HTTPS for a remote app, or HTTP on localhost.');
  }
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) throw new Error('A graphical desktop is required. Run this command on the bot workstation or inside its desktop VM.');
  const profile = (platform === 'win32' ? path.win32 : path.posix).join(root, 'data', 'browser-profile');
  return {
    profile, origin: target.origin,
    args: [`--user-data-dir=${profile}`, '--no-first-run', '--new-window', '--start-maximized', target.href, 'https://www.facebook.com/'],
  };
}
