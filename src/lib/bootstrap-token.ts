import { serverSecret } from "./server-secret";
import { timingSafeEqual } from "node:crypto";
import { isLocalRequest } from "./request-security";

/** Recovery always needs a server-held token. Only unconfigured development setup may skip on loopback. */
export function bootstrapTokenOk(request: Request, givenToken?: string | null): boolean {
  const expected = Buffer.from(serverSecret("BOOTSTRAP_TOKEN"));
  if (!expected.length && process.env.NODE_ENV !== "production" && new URL(request.url).pathname === "/api/auth/setup"
    && isLocalRequest(request.headers, request.url)
    && (!process.env.AUTH_URL || ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.AUTH_URL).hostname))) return true;
  const given = Buffer.from(givenToken || "");
  if (expected.length < 24 || given.length !== expected.length) return false;
  return timingSafeEqual(expected, given);
}

export function bootstrapTokenErrorMessage() {
  return "ต้องใช้รหัสตั้งระบบครั้งแรกจาก environment ของเซิร์ฟเวอร์";
}
