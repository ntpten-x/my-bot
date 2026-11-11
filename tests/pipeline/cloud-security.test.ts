import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { allowedCorsOrigin, isHttpsRequest, isLocalNetworkHost, isLocalRequest, isPrivateLanHost, transportAllowed } from "../../src/lib/request-security";
import { isWeakPassword, passwordProblems } from "../../src/lib/password-policy";
import { LOGIN_POLICY, checkLogin, memoryGuardStore, recordLogin } from "../../src/lib/login-guard";
import { newDeviceToken, newPairingCode, normalizeCode, sha256, tokenHint } from "../../src/lib/extension-devices";
import { createZip } from "../../src/lib/zip";

const h = (values: Record<string, string>) => new Headers(values);

describe("request security", () => {
  it("detects https behind Render's proxy and local hosts", () => {
    expect(isHttpsRequest(h({ "x-forwarded-proto": "https" }), "http://my-bot.onrender.com/api")).toBe(true);
    expect(isHttpsRequest(h({}), "http://example.com/api")).toBe(false);
    expect(isLocalRequest(h({ host: "localhost:8001" }))).toBe(true);
    expect(isLocalRequest(h({ host: "my-bot-e6bt.onrender.com" }))).toBe(false);
  });

  it("allows tokens only over https or on the local machine", () => {
    expect(transportAllowed(h({ host: "127.0.0.1:8001" }), "http://127.0.0.1:8001/api")).toBe(true);
    expect(transportAllowed(h({ host: "192.168.1.40:8001" }), "http://192.168.1.40:8001/api")).toBe(true);
    expect(isPrivateLanHost("192.168.1.40:8001")).toBe(true);
    expect(isLocalNetworkHost("10.0.0.5")).toBe(true);
    expect(isLocalRequest(h({ host: "192.168.1.40:8001" }))).toBe(false);
    expect(transportAllowed(h({ host: "evil.example", "x-forwarded-proto": "http" }), "http://evil.example/api")).toBe(false);
    expect(transportAllowed(h({ host: "my-bot-e6bt.onrender.com", "x-forwarded-proto": "https" }), "http://my-bot-e6bt.onrender.com/api")).toBe(true);
  });

  it("limits CORS to the extension and the site itself", () => {
    const self = "https://my-bot-e6bt.onrender.com";
    expect(allowedCorsOrigin(`chrome-extension://${"a".repeat(32)}`, self)).toBeTruthy();
    expect(allowedCorsOrigin(self, self)).toBe(self);
    expect(allowedCorsOrigin("https://evil.example", self)).toBeNull();
    expect(allowedCorsOrigin(null, self)).toBeNull();
  });
});

describe("password policy", () => {
  it("rejects short, common or simple passwords and accepts a strong one", () => {
    expect(passwordProblems("short1A").length).toBeGreaterThan(0);
    expect(isWeakPassword("password1234")).toBe(true);
    expect(isWeakPassword("aaaaaaaaaaaaaa")).toBe(true);
    expect(isWeakPassword("abcdefghijkl")).toBe(true);
    expect(passwordProblems("Kluay-Mango-2026x")).toEqual([]);
  });
});

describe("login lockout", () => {
  it("locks one IP after repeated failures and unlocks after the window", async () => {
    const store = memoryGuardStore();
    const t0 = new Date("2026-11-05T00:00:00Z");
    for (let i = 0; i < LOGIN_POLICY.perIpFailures; i++) await recordLogin(store, "1.2.3.4", false, t0);
    expect(await checkLogin(store, "1.2.3.4", t0)).toBeGreaterThan(0);
    expect(await checkLogin(store, "5.6.7.8", t0)).toBe(0);
    expect(await checkLogin(store, "1.2.3.4", new Date(t0.getTime() + LOGIN_POLICY.perIpLockMs + 1000))).toBe(0);
  });

  it("clears an IP's failures after a successful login", async () => {
    const store = memoryGuardStore();
    const now = new Date();
    for (let i = 0; i < LOGIN_POLICY.perIpFailures - 1; i++) await recordLogin(store, "9.9.9.9", false, now);
    await recordLogin(store, "9.9.9.9", true, now);
    await recordLogin(store, "9.9.9.9", false, now);
    expect(await checkLogin(store, "9.9.9.9", now)).toBe(0);
  });
});

describe("extension pairing", () => {
  it("makes readable one-time codes and normalizes what the user types", () => {
    const code = newPairingCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(normalizeCode(code.toLowerCase().replace("-", " "))).toBe(normalizeCode(code));
  });

  it("issues prefixed device tokens and only stores hashes", () => {
    const token = newDeviceToken();
    expect(token.startsWith("mbd_")).toBe(true);
    expect(token.length).toBeGreaterThan(30);
    expect(sha256(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHint(token)).toBe(`mbd_…${token.slice(-4)}`);
  });
});

describe("zip", () => {
  it("writes a valid archive whose entries inflate back", () => {
    const zip = createZip([{ name: "mybot-extension/manifest.json", data: Buffer.from('{"version":"1.5.0"}') }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    expect(end).toBeGreaterThan(0);
    expect(zip.readUInt16LE(end + 10)).toBe(1);
    const nameLen = zip.readUInt16LE(26);
    const extraLen = zip.readUInt16LE(28);
    const size = zip.readUInt32LE(18);
    const body = zip.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + size);
    const method = zip.readUInt16LE(8);
    expect((method === 8 ? inflateRawSync(body) : body).toString()).toBe('{"version":"1.5.0"}');
  });
});