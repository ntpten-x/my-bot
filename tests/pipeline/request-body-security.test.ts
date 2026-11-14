import { expect, it } from "vitest";
import { readBody, readJson } from "../../src/lib/request-body";
it("bounds chunked request bodies before parsing JSON without trusting Content-Length", async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32)); }, cancel() { cancelled = true; } });
  const request = new Request("http://synthetic.invalid", { method: "POST", body, duplex: "half" } as RequestInit);
  await expect(readBody(request, 16)).rejects.toThrow("too large");
  expect(cancelled).toBe(true);
});
it("rejects oversized declarations and accepts bounded UTF-8 JSON", async () => {
  await expect(readBody(new Request("http://synthetic.invalid", { headers: { "content-length": "100" } }), 10)).rejects.toThrow();
  expect(await readJson(new Request("http://synthetic.invalid", { method: "POST", body: JSON.stringify({ text: "ไทย" }) }), 100)).toEqual({ text: "ไทย" });
});
it("honors cancellation without waiting for a stalled client body", async () => {
  const controller = new AbortController();
  const body = new ReadableStream({});
  const request = new Request("http://synthetic.invalid", { method: "POST", body, signal: controller.signal, duplex: "half" } as RequestInit);
  const pending = expect(readBody(request)).rejects.toThrow("aborted");
  controller.abort(); await pending;
});
