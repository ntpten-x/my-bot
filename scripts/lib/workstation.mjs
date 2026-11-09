import net from 'node:net';

export const WORKSTATION_INTERVAL_MS = 15_000;
export const restartDelay = failures => Math.min(300_000, 3000 * 2 ** Math.min(7, Math.max(0, failures - 1)));

export function desktopPorts(raw = {}) {
  const vncPort = raw.vncPort ?? 5905, viewerPort = raw.viewerPort ?? 6085;
  if (![vncPort, viewerPort].every(port => Number.isInteger(port) && port >= 1024 && port <= 65535) || vncPort === viewerPort) throw new Error('Invalid Desktop viewer ports.');
  return { vncPort, viewerPort };
}

export function workstationConfig(raw = null) {
  if (raw === null) return { mode: 'local', serverOrigin: 'http://localhost:8001' };
  if (raw?.mode !== 'remote') throw new Error('Invalid workstation mode.');
  const url = new URL(raw.serverOrigin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use a public HTTPS server origin.');
  return { mode: 'remote', serverOrigin: url.origin,
    ...(raw.vncPort !== undefined || raw.viewerPort !== undefined ? desktopPorts(raw) : {}) };
}

export async function portOpen(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = open => { socket.destroy(); resolve(open); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

export async function webReady(fetcher = fetch, serverOrigin = 'http://127.0.0.1:8001') {
  try {
    const response = await fetcher(`${serverOrigin}/api/v1/health`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    const body = await response.json();
    return response.ok && body?.ok === true && typeof body.version === 'string';
  } catch { return false; }
}

export async function viewerReady(fetcher = fetch, port = 6085) {
  try {
    return (await fetcher(`http://127.0.0.1:${port}/vnc.html`, { method: 'HEAD', signal: AbortSignal.timeout(2000), redirect: 'error' })).ok;
  } catch { return false; }
}

// No PID adoption: an existing listener may be someone else's service. Only children
// started by this process are stopped. A missing desktop after startup is latched
// for owner review because it may have contained an uncertain comment send.
export function desktopAction({ firstCheck, vnc, viewer, attempted, allowExisting = true }) {
  if (vnc && viewer) return !allowExisting && !attempted ? 'conflict' : 'ready';
  if (vnc || viewer) return 'partial';
  return firstCheck && !attempted ? 'start' : 'review';
}
