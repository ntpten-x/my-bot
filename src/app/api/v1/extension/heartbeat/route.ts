import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { heartbeatSchema, noteBadExtensionToken, recordHeartbeat, EXPECTED_EXTENSION_VERSION } from "@/lib/extension-heartbeat";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

// Read-only status from the browser extension: version, Facebook login (account id only), open group tabs, last error.
export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization")))) {
    await noteBadExtensionToken();
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, 400));
  await recordHeartbeat(parsed.data);
  return withCors(json({ ok: true, expectedVersion: EXPECTED_EXTENSION_VERSION }));
}
