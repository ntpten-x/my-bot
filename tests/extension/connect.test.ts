import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

function harness(desktop = false) {
  const local: Record<string, unknown> = { apiBase: "https://owner.example", paused: true };
  const session: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({ get: async (defaults: object) => ({ ...defaults, ...structuredClone(data) }), set: async (value: object) => Object.assign(data, structuredClone(value)), remove: async (key: string) => { delete data[key]; } });
  const tabs = { create: vi.fn(async (value: object) => ({ id: 10, ...value })), get: vi.fn(async () => ({ id: 1 })) };
  const deps = { loadConfig: async () => local, base: (cfg: { apiBase: string }) => cfg.apiBase, syncCustomBridge: vi.fn(async () => undefined), ready: vi.fn(async () => undefined) };
  const context = vm.createContext({ URL, Date, Uint8Array, TextEncoder, AbortSignal, crypto: globalThis.crypto,
    fetch: async (url: string) => {
      if (String(url).includes("/api/v1/health")) return { ok: true, json: async () => ({ ok: true, version: "1.3.7" }) };
      return { ok: !url.endsWith("desktop-config.json") || desktop,
        json: async () => url.endsWith("desktop-config.json") ? { dedicatedReaderDesktop: desktop } : { apiBase: "http://localhost:8001" } };
    },
    chrome: { runtime: { getURL: (file: string) => `chrome-extension://synthetic/${file}` }, tabs, storage: { local: area(local), session: area(session) } },
  });
  vm.runInContext(readFileSync("extension/connect.js", "utf8"), context);
  type Reply = { ok: boolean; paired?: boolean; nonce?: string; tokenHash?: string; tokenHint?: string };
  const connect = context.MyBotConnect as { handle(message: object, sender: object, deps: object): Promise<Reply>; installed(details: object, deps: object): Promise<void> };
  const sender = { tab: { id: 1 }, frameId: 0, url: "https://owner.example/settings/extension" };
  return { local, session, tabs, deps, sender, connect,
    begin: () => connect.handle({ type: "extension-connect-begin" }, sender, deps),
    complete: (reply: Reply, extra = {}) => connect.handle({ type: "extension-connect-complete", nonce: reply.nonce, tokenHash: reply.tokenHash, deviceId: "synthetic-device", ...extra }, sender, deps),
  };
}

it("creates the credential inside Chrome and exposes only its fingerprint to the page", async () => {
  const h = harness(); const begin = await h.begin();
  expect(begin).toMatchObject({ ok: true, paired: false });
  expect(begin.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(begin.tokenHint).toMatch(/^mbd_…[a-f0-9]{4}$/);
  expect(begin).not.toHaveProperty("token");
  const pending = h.local.pendingExtensionConnection as { token: string };
  expect(pending.token).toMatch(/^mbd_[a-f0-9]{64}$/);
  expect(JSON.stringify(begin)).not.toContain(pending.token);
  await h.complete(begin, { token: "mbd_page-controlled-value" });
  expect(h.local.token).toBe(pending.token);
  expect(h.local.paused).toBe(true);
  expect(h.local.pendingExtensionConnection).toBeUndefined();
  expect(h.deps.ready).toHaveBeenCalledTimes(1);
});

it("reuses a pending fingerprint across retry and rotates only the request nonce", async () => {
  const h = harness(); const first = await h.begin(); const second = await h.begin();
  expect(second.tokenHash).toBe(first.tokenHash); expect(second.nonce).not.toBe(first.nonce);
  expect((await h.complete(first)).ok).toBe(false);
  expect((await h.complete(second)).ok).toBe(true);
});

it("rejects untrusted origins, subframes, expired requests and forged fingerprints", async () => {
  const h = harness(); const begin = await h.begin();
  for (const sender of [{ ...h.sender, url: "https://evil.example/" }, { ...h.sender, frameId: 1 }]) {
    expect((await h.connect.handle({ type: "extension-connect-begin" }, sender, h.deps)).ok).toBe(false);
  }
  expect((await h.complete(begin, { nonce: "wrong" })).ok).toBe(false);
  expect((await h.complete(begin, { tokenHash: "0".repeat(64) })).ok).toBe(false);
  (h.session.extensionConnectAttempt as { until: number }).until = 0;
  expect((await h.complete(begin)).ok).toBe(false);
  expect(h.local.token).toBeUndefined();
});

it("never overwrites existing pairing or owner pause on installation/update", async () => {
  const h = harness(); h.local.token = "mbd_existing";
  expect(await h.begin()).toMatchObject({ paired: true });
  await h.connect.installed({ reason: "install" }, h.deps);
  await h.connect.installed({ reason: "update" }, h.deps);
  expect(h.local.token).toBe("mbd_existing"); expect(h.local.paused).toBe(true);
  expect(h.tabs.create).not.toHaveBeenCalled();
});

it("opens the bundled server automatically on a fresh install without credentials", async () => {
  const h = harness(); await h.connect.installed({ reason: "install" }, h.deps);
  expect(h.local.apiBase).toBe("http://127.0.0.1:8001");
  expect(h.tabs.create).toHaveBeenCalledWith({ url: "http://127.0.0.1:8001/settings/extension", active: true });
  expect(h.local.apiBaseMode).toBe("auto");
  expect(h.local.token).toBeUndefined();
  expect(h.local.dedicatedReaderDesktop).toBeUndefined();
});

it('opts into isolated display focus only on a fresh Desktop install, preserving update/pairing controls', async () => {
  const h = harness(true); await h.connect.installed({ reason: 'install' }, h.deps);
  expect(h.local.dedicatedReaderDesktop).toBe(true);
  expect(h.local.paused).toBe(true);
  expect(h.local.token).toBeUndefined();
  const updated = harness(true); updated.local.dedicatedReaderDesktop = false;
  await updated.connect.installed({ reason: 'update' }, updated.deps);
  expect(updated.local.dedicatedReaderDesktop).toBe(false);
  const paired = harness(true); paired.local.token = 'synthetic-existing';
  await paired.connect.installed({ reason: 'install' }, paired.deps);
  expect(paired.local.dedicatedReaderDesktop).toBeUndefined();
});

it("serializes enrollment tabs and rejects completion after a server change", async () => {
  const h = harness(); const begin = await h.begin();
  expect((await h.connect.handle({ type: "extension-connect-begin" }, { ...h.sender, tab: { id: 2 } }, h.deps)).ok).toBe(false);
  h.local.apiBase = "https://other.example";
  expect((await h.complete(begin)).ok).toBe(false);
  expect(h.local.token).toBeUndefined();
});
