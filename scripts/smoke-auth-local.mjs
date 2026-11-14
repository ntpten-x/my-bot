// Production HTTP smoke, disposable local PostgreSQL only. No owner credentials or Infra key inherited.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, symlinkSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const root = process.cwd();
const base = new URL(process.env.TEST_DATABASE_URL || 'postgresql://invalid');
const socketDirectory = base.searchParams.get('host') || '';
if (base.protocol !== 'postgresql:' || base.hostname !== 'localhost' || base.port !== '55439' || !/^\/tmp\/mybot-cadence-pg-[A-Za-z0-9]+$/.test(socketDirectory)) throw Error('Use the dedicated local Unix-socket test cluster only');
const schema = `test_auth_smoke_${randomUUID().replaceAll('-', '')}`;
base.searchParams.set('schema', schema);
const db = new PrismaClient({ datasourceUrl: base.toString(), log: [] });
const directory = mkdtempSync(path.join(tmpdir(), 'mybot-auth-http-'));
let child;
let labOrigin = '';
let nextRequest = 0, requests = 0;
const fetch = async (url, init = {}) => {
  if (new URL(url).origin !== labOrigin || ++requests > 40) throw Error('Outside isolated HTTP test scope');
  await new Promise(resolve => setTimeout(resolve, Math.max(0, nextRequest - Date.now())));
  nextRequest = Date.now() + 500;
  return globalThis.fetch(url, { ...init, redirect: 'manual' });
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const origin = `http://127.0.0.1:${port}`; labOrigin = origin;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    DATABASE_URL: base.toString(), DIRECT_URL: base.toString(), AI_KEY_SECRET: 'synthetic-isolated-production-smoke-secret',
    AUTH_URL: origin };
  for (const name of ['node_modules', '.next', 'public']) symlinkSync(path.join(root, name), path.join(directory, name), 'dir');
  for (const name of ['package.json', 'next.config.ts', 'prisma']) cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
  execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { cwd: directory, env, stdio: 'pipe' });
  const password = 'Synthetic-Http-Only-Owner-1234';
  await db.owner.create({ data: { id: 'http-owner', passwordHash: await bcrypt.hash(password, 4) } });
  child = spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: directory, env, stdio: 'ignore', detached: true });
  const until = Date.now() + 30000; let ready = false;
  while (Date.now() < until) { try { if ((await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {} await delay(200); }
  if (!ready) throw Error('Test web did not start');
  const post = (url, body, cookie = '', extra = {}) => fetch(origin + url, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie, ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const document = await fetch(`${origin}/login`);
  const html = await document.text();
  const nonce = document.headers.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1];
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(match => match[0]);
  if (!nonce || !scripts.length || scripts.some(tag => !tag.includes(`nonce="${nonce}"`))) throw Error('Production hydration scripts lack the CSP nonce');
  const denied = await fetch(`${origin}/api/auth/sessions`); if (denied.status !== 401) throw Error('Unauthenticated session access');
  const evil = await post('/api/auth/login', { username: "admin", password }, '', { origin: 'https://other.example' }); if (evil.status !== 403) throw Error('Cross-origin sign in accepted');
  const result = await post('/api/auth/login', { username: "admin", password }); if (!result.ok) throw Error('Production login failed');
  const cookie = result.headers.getSetCookie().map(c => c.split(';')[0]).filter(c => !c.endsWith('=')).join('; ');
  if (!cookie.includes('mybot_session=')) throw Error('Missing production auth cookie');
  if (!(await fetch(`${origin}/api/auth/me`, { headers: { cookie } })).ok) throw Error('Owner session not authorized');
  const response = await fetch(`${origin}/api/auth/sessions`, { headers: { cookie } });
  const rows = await response.json(); if (!rows.sessions?.some(row => row.current) || JSON.stringify(rows).includes('session_token')) throw Error('Unsafe session list');
  const signup = await post('/api/better-auth/sign-up/email', { name: 'Outsider', email: 'outsider@example.com', password }); if (signup.status !== 404) throw Error('Public registration exposed');
  const out = await post('/api/auth/logout', {}, cookie); if (!out.ok) throw Error('Production logout failed');
  if ((await fetch(`${origin}/api/auth/me`, { headers: { cookie } })).status !== 401) throw Error('Revoked session accepted');
  const staleLogin = await fetch(`${origin}/login`, { headers: { cookie }, redirect: 'manual' });
  if (staleLogin.status !== 200) throw Error('Stale cookie prevents login form');
  console.log('PASS production HTTP: existing-owner login, hashed session cookie, protected API, CSRF, no signup, session list and logout revocation');
} catch {
  console.error('FAIL isolated auth HTTP smoke (credentials and environment withheld)'); process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch {}
    for (let count = 0; count < 50 && child.exitCode === null && child.signalCode === null; count++) await delay(100);
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  }
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.$disconnect();
  rmSync(directory, { recursive: true, force: true });
}
