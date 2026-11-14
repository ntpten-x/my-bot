import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { publicAddress } from '../src/lib/public-address.cjs';

// Deployment monitoring only: no credentials, no redirects, one fixed public path.
export async function scopedHealth(origin, timeoutMs = 15000) {
  const deadline = Date.now() + Math.min(15000, Math.max(1, timeoutMs));
  const allowed = (process.env.HEALTH_ALLOWED_ORIGINS || 'https://mb-agcf.onrender.com').split(',').map(value => value.trim());
  const url = new URL(origin);
  if (url.origin !== origin || !allowed.includes(origin) || url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('Origin outside deployment health scope');
  let timer;
  const addresses = await Promise.race([lookup(url.hostname, { all: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Health DNS timeout')), Math.max(1, deadline - Date.now())); })]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(row => !publicAddress(row.address))) throw Error('Health destination outside public scope');
  url.pathname = '/api/v1/health';
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())), lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family) }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) { response.destroy(); reject(Error('Health redirect refused')); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 65536) { response.destroy(); reject(Error('Oversized health response')); } else chunks.push(chunk); });
      response.on('end', () => {
        let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ status: response.statusCode, ok: response.statusCode === 200 && body.ok === true, commit: String(response.headers['x-mybot-commit'] || ''), version: typeof body.version === 'string' ? body.version.slice(0, 40) : '' });
      });
      response.on('error', () => reject(Error('Health read failed')));
      response.on('aborted', () => reject(Error('Health read interrupted')));
    });
    req.on('error', () => reject(Error('Health connection failed'))); req.end();
  });
}
