import { pausedFacebookIds } from "@/lib/facebook-accounts";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { heartbeatSchema, noteBadExtensionToken, recordHeartbeat, EXPECTED_EXTENSION_VERSION } from "@/lib/extension-heartbeat";
import { verifyDeviceToken } from "@/lib/extension-devices";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

// Read-only status from the browser extension: version, Facebook login (account id only), open group tabs, last error.
export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization"), request))) {
    await noteBadExtensionToken();
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const parsed = heartbeatSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return withCors(json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, 400));
  const deviceId = await verifyDeviceToken((request.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  await recordHeartbeat(parsed.data, deviceId || undefined);
  const accountPaused = (await pausedFacebookIds()).has(parsed.data.fb.id);
  const current = parsed.data.version.trim() === EXPECTED_EXTENSION_VERSION;
  return withCors(
    json({
      ok: true,
      expectedVersion: EXPECTED_EXTENSION_VERSION,
      scrapeAllowed: current && !accountPaused,
      accountPaused,
      upgradeRequired: !current,
    }),
  );
}
