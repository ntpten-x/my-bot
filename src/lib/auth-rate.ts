import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { json } from "./http";
const buckets = new Map<string, { used: number; until: number }>();
export function requestIdentity(request: Request) {
  const hops = Number(process.env.TRUST_PROXY_HOPS || 0);
  const chain = (request.headers.get("x-forwarded-for") || "").split(",").map(value => value.trim());
  const candidate = Number.isInteger(hops) && hops >= 1 && hops <= 3 ? chain.at(-hops) || "" : "";
  return createHash("sha256").update(isIP(candidate) ? candidate : "untrusted-shared").digest("hex");
}
function take(key: string, limit: number, now: number) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) { bucket = { used: 0, until: now + 60_000 }; buckets.delete(key); buckets.set(key, bucket); }
  bucket.used++;
  while (buckets.size > 4096) buckets.delete(buckets.keys().next().value!);
  return bucket.used <= limit;
}
/** Run before database access. A shared fallback is deliberate until proxy trust is configured. */
export function authRateError(request: Request, now = Date.now()) {
  if (take("global", 120, now) && take(`client:${requestIdentity(request)}`, 20, now)) return null;
  const response = json({ error: "เรียกยืนยันตัวตนบ่อยเกินไป กรุณารอสักครู่" }, 429);
  response.headers.set("Retry-After", "60"); return response;
}
