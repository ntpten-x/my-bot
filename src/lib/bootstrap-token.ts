import { timingSafeEqual } from "node:crypto";
import { isLocalRequest } from "./request-security";

/** Same rule as /setup: localhost may skip; cloud requires env BOOTSTRAP_TOKEN (≥24) with timing-safe match. */
export function bootstrapTokenOk(request: Request, givenToken?: string | null): boolean {
  if (isLocalRequest(request.headers, request.url)) return true;
  const expected = Buffer.from(process.env.BOOTSTRAP_TOKEN || "");
  const given = Buffer.from(givenToken || "");
  if (expected.length < 24 || given.length !== expected.length) return false;
  return timingSafeEqual(expected, given);
}

export function bootstrapTokenErrorMessage() {
  return "ต้องใช้รหัสตั้งระบบครั้งแรกจาก environment ของเซิร์ฟเวอร์";
}
