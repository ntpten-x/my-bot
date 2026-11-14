/** Bound bytes while streaming, including requests without Content-Length. */
export async function readBody(request: Request, maxBytes = 1_500_000): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Request body too large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => { reject(new Error("Request body timed out or aborted")); void reader.cancel().catch(() => undefined); };
    if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (signal.aborted) throw new Error("Request body timed out or aborted");
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => undefined); throw new Error("Request body too large"); }
      chunks.push(value);
    }
  } finally { signal.removeEventListener("abort", onAbort); reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}
export async function readJson(request: Request, maxBytes = 1_500_000): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readBody(request, maxBytes)));
}
export async function readFormData(request: Request, maxBytes: number) {
  const bytes = await readBody(request, maxBytes);
  return new Response(bytes as BodyInit, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData();
}
