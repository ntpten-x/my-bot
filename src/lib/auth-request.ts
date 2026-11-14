import { json } from "./http";
import { selfOriginOf } from "./request-security";
import { authOrigins } from "./auth-origins";

/** Reject browser cross-origin credential changes before reading or hashing a password. */
export function authMutationError(request: Request, requireJson = true) {
  const origin = request.headers.get("origin");
  const allowed = process.env.AUTH_URL
    ? authOrigins() : [selfOriginOf(request.headers, request.url)];
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && !allowed.includes(origin))) {
    return json({ error: "อนุญาตคำขอจากหน้า MY-BOT นี้เท่านั้น" }, 403);
  }
  if (requireJson && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "ต้องส่งข้อมูล JSON" }, 415);
  }
  return null;
}
