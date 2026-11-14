import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
type MockResponse = Readable & { statusCode: number; headers: Record<string, string> };
type MockOptions = { lookup: (host: string, options: { all?: boolean }, callback: (error: Error | null, address: string | unknown[], family?: number) => void) => void };
type MockHandler = (url: URL, options: MockOptions, cb: (response: MockResponse) => void) => void;
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), handler: null as null | MockHandler }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));
import { fetchPublicText } from "../../src/lib/public-http";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.request.mockImplementation((url, options, cb) => {
    const request = new EventEmitter() as EventEmitter & { end(): void };
    request.end = () => queueMicrotask(() => mocks.handler?.(url, options, cb));
    return request;
  });
  mocks.handler = (_url, _options, cb) => { const res = Readable.from([Buffer.from("feed")]); Object.assign(res, { statusCode: 200, headers: {} }); cb(res); };
});
afterEach(() => vi.useRealTimers());
it("rejects loopback, IPv6, metadata, credentials and unexpected protocols/ports before sending traffic", async () => {
  for (const url of ["http://127.0.0.1", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://[2002:0a00:0001::]", "http://[2001:0000:0000:0000::1]", "http://169.254.169.254/latest", "http://10.0.0.1", "http://localhost", "http://example.local", "ftp://example.com", "https://user:secret@example.com", "https://example.com:8000"]) {
    await expect(fetchPublicText(url)).rejects.toThrow();
  }
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rejects mixed public/private DNS answers", async () => {
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]);
  await expect(fetchPublicText("https://feed.example")).rejects.toThrow();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("pins validated DNS to the HTTP request and bounds redirects to private IPs", async () => {
  mocks.handler = (_url, options, cb) => {
    options.lookup("feed.example", {}, (_error, address) => expect(address).toBe("8.8.8.8"));
    const res = Readable.from([]); Object.assign(res, { statusCode: 302, headers: { location: "http://127.0.0.1/secret" } }); cb(res);
  };
  await expect(fetchPublicText("https://feed.example")).rejects.toThrow();
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("bounds bytes even without Content-Length and accepts a normal public feed", async () => {
  expect(await fetchPublicText("https://feed.example")).toBe("feed");
  await expect(fetchPublicText("https://feed.example", { maxBytes: 3 })).rejects.toThrow("large");
});
it("bounds DNS resolution time", async () => {
  vi.useFakeTimers(); mocks.lookup.mockImplementation(() => new Promise(() => {}));
  const pending = expect(fetchPublicText("https://feed.example", { timeoutMs: 50 })).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(51); await pending;
  expect(mocks.request).not.toHaveBeenCalled();
});
