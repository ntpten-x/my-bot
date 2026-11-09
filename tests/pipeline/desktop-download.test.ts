import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ authenticated: true }));
vi.mock('../../src/lib/guard', () => ({ authed: async () => state.authenticated ? {} : { error: Response.json({ error: 'unauthorized' }, { status: 401 }) } }));
import { GET } from '../../src/app/api/desktop-download/route';
beforeEach(() => { state.authenticated = true; });

it('does not distribute the installer without an owner session', async () => {
  state.authenticated = false;
  const response = await GET(new Request('https://owner.example/api/desktop-download'));
  expect(response.status).toBe(401);
});
it('serves a private, origin-bound ZIP from production only', async () => {
  const response = await GET(new Request('https://owner.example/api/desktop-download', { headers: { host: 'owner.example' } }));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/zip');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-disposition')).toContain('0.1.5-preview');
  const data = new Uint8Array(await response.arrayBuffer());
  expect([...data.slice(0, 2)]).toEqual([80, 75]);
});
it('rejects a localhost installer rather than silently binding customers to local services', async () => {
  const response = await GET(new Request('http://localhost:8001/api/desktop-download', { headers: { host: 'localhost:8001' } }));
  expect(response.status).toBe(400);
});
it('refuses downloads when DESKTOP_PUBLIC_ORIGIN does not match the request host', async () => {
  const previous = process.env.DESKTOP_PUBLIC_ORIGIN;
  process.env.DESKTOP_PUBLIC_ORIGIN = 'https://canonical.example';
  try {
    const response = await GET(new Request('https://other.example/api/desktop-download', { headers: { host: 'other.example' } }));
    expect(response.status).toBe(400);
  } finally {
    if (previous === undefined) delete process.env.DESKTOP_PUBLIC_ORIGIN;
    else process.env.DESKTOP_PUBLIC_ORIGIN = previous;
  }
});
