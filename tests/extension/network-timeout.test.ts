import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

const source = readFileSync("extension/background.js", "utf8");
function harness(fetch: typeof globalThis.fetch) {
  const context = vm.createContext({
    fetch, Response, Uint8Array, AbortController, setTimeout, clearTimeout,
    sleep: async () => undefined, Math,
  });
  vm.runInContext(source.slice(source.indexOf("const RETRY_STATUS ="), source.indexOf("async function postJson")), context);
  return (options = {}) => vm.runInContext("fetchRetry", context)("https://synthetic.example/api", {}, { timeoutMs: 100, retries: 0, ...options }) as Promise<Response>;
}
afterEach(() => { vi.useRealTimers(); });

it("times out a response whose headers arrive but body never finishes", async () => {
  vi.useFakeTimers();
  let stream: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; }, cancel }));
  const request = harness(async () => response);
  let outcome = "pending";
  const work = request().then(result => result.json()).then(() => { outcome = "complete"; }, () => { outcome = "timeout"; });
  try {
    await vi.advanceTimersByTimeAsync(101);
    expect(outcome).toBe("timeout");
    expect(cancel).toHaveBeenCalledTimes(1);
  } finally {
    if (!cancel.mock.calls.length) stream!.close();
    await work;
  }
});

it("cancels retryable error bodies before retrying instead of waiting on them", async () => {
  const cancel = vi.fn();
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  const response = await harness(fetch)({ retries: 1 });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("preserves status and headers for permanent errors and empty responses", async () => {
  const response = await harness(async () => new Response('{"error":"unauthorized"}', { status: 401, headers: { "x-test": "retained" } }))();
  expect(response.status).toBe(401);
  expect(response.headers.get("x-test")).toBe("retained");
  expect(await response.json()).toEqual({ error: "unauthorized" });
  const empty = await harness(async () => new Response(null, { status: 204 }))();
  expect(empty.status).toBe(204);
  expect(await empty.text()).toBe("");
});

it("rejects an oversized response and releases the stream", async () => {
  const cancel = vi.fn();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel,
  }));
  await expect(harness(async () => response)()).rejects.toThrow();
  expect(cancel).toHaveBeenCalledTimes(1);
});
