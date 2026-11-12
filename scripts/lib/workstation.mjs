import net from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const WORKSTATION_INTERVAL_MS = 15_000;
export const restartDelay = failures => Math.min(300_000, 3000 * 2 ** Math.min(7, Math.max(0, failures - 1)));

const requestId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function queueWorkstationRequest(directory, request) {
  if (!requestId.test(request?.session) || !requestId.test(request?.nonce) || !['stop', 'resume-desktop'].includes(request?.action)) throw new Error('Invalid workstation request.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${request.session}.${request.nonce}.json`);
  // Separate exclusive files keep concurrent Stop and Resume commands from overwriting each other.
  await writeFile(file, JSON.stringify(request), { mode: 0o600, flag: 'wx' });
  return file;
}

export async function readWorkstationRequests(directory, session) {
  if (!requestId.test(session)) return [];
  let files;
  try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const requests = [];
  for (const name of files) {
    const suffix = name.slice(session.length + 1, -5);
    if (!name.startsWith(`${session}.`) || !name.endsWith('.json') || !requestId.test(suffix)) continue;
    const file = path.join(directory, name);
    try {
      const request = JSON.parse(await readFile(file, 'utf8'));
      if (request.session === session && request.nonce === suffix && ['stop', 'resume-desktop'].includes(request.action)) requests.push({ file, request });
    } catch { /* A command still being written is retried on the next pass. */ }
  }
  return requests.sort((a, b) => Number(b.request.action === 'stop') - Number(a.request.action === 'stop'));
}

// Listener availability alone cannot prove the desktop supervisor is progressing.
export function desktopComponentsReady(details, session, now = Date.now()) {
  const age = now - Date.parse(details?.at);
  return Boolean(session && details?.session === session && age >= 0 && age < 60_000 &&
    details.phase === 'running' && ['Virtual display', 'Window manager', 'Desktop viewer', 'Web viewer', 'Browser']
      .every(name => details.components?.[name] === 'running'));
}

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

// Read only the server banner. Never negotiate authentication or send desktop input.
export function viewerTransport(port, timeoutMs = 2000) {
  return new Promise(resolve => {
    const key = randomBytes(16).toString('base64');
    const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    const socket = net.connect({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0), banner = Buffer.alloc(0), upgraded = false, settled = false;
    const finish = phase => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ ok: phase === 'rfb-ready', phase });
    };
    const timer = setTimeout(() => finish(upgraded ? 'rfb-timeout' : 'websocket-timeout'), Math.max(1, timeoutMs));
    socket.once('connect', () => socket.write(`GET /websockify HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\n\r\n`));
    socket.once('error', () => finish('unreachable'));
    socket.once('end', () => finish('closed'));
    socket.once('close', () => finish('closed'));
    socket.on('data', chunk => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) { if (buffer.length > 8192) finish('invalid-upgrade'); return; }
        if (end > 8192) return finish('invalid-upgrade');
        const lines = buffer.subarray(0, end).toString('ascii').split('\r\n');
        const headers = Object.fromEntries(lines.slice(1).map(line => {
          const colon = line.indexOf(':'); return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
        }));
        if (!/^HTTP\/1\.1 101(?: |$)/.test(lines[0]) || headers.upgrade?.toLowerCase() !== 'websocket' ||
          !headers.connection?.toLowerCase().split(/\s*,\s*/).includes('upgrade') || headers['sec-websocket-accept'] !== expected) return finish('invalid-upgrade');
        upgraded = true;
        buffer = buffer.subarray(end + 4);
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15;
        let size = buffer[1] & 127, offset = 2;
        if ((buffer[0] & 0x70) || (buffer[1] & 0x80) || ![0, 2].includes(opcode) || size === 127) return finish('invalid-rfb');
        if (size === 126) { if (buffer.length < 4) return; size = buffer.readUInt16BE(2); offset = 4; }
        if (size > 1024 || buffer.length > 4096) return finish('invalid-rfb');
        if (buffer.length < offset + size) return;
        banner = Buffer.concat([banner, buffer.subarray(offset, offset + size)]);
        buffer = buffer.subarray(offset + size);
        if (banner.length >= 12) return finish(/^RFB 003\.(003|007|008)\n$/.test(banner.subarray(0, 12).toString('ascii')) ? 'rfb-ready' : 'invalid-rfb');
      }
    });
  });
}

export function vncBannerReady(port, timeoutMs = 1000) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0);
    const finish = ok => { clearTimeout(timer); socket.destroy(); resolve(ok); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('error', () => finish(false));
    socket.once('end', () => finish(false));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= 12) finish(/^RFB 003\.(003|007|008)\n$/.test(buffer.subarray(0, 12).toString('ascii')));
    });
  });
}

export async function viewerHealth(fetcher = fetch, port = 6085) {
  const started = Date.now();
  let result = { ok: false, phase: 'http-unavailable' };
  try {
    const response = await fetcher(`http://127.0.0.1:${port}/vnc.html`, { method: 'HEAD', signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (response.ok) result = await viewerTransport(port, Math.max(1, 2000 - (Date.now() - started)));
  } catch { /* Availability probes never interrupt the supervisor. */ }
  return { ...result, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started };
}

export async function viewerReady(fetcher = fetch, port = 6085) {
  return (await viewerHealth(fetcher, port)).ok;
}

// No PID adoption: an existing listener may be someone else's service. Only children
// started by this process are stopped. A missing desktop after startup is latched
// for owner review because it may have contained an uncertain comment send.
export function desktopAction({ firstCheck, vnc, viewer, attempted, allowExisting = true }) {
  if (vnc && viewer) return !allowExisting && !attempted ? 'conflict' : 'ready';
  if (vnc || viewer) return 'partial';
  return firstCheck && !attempted ? 'start' : 'review';
}
