import { facebookWorkAllowed } from "@/lib/facebook-accounts";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { buildExtensionConfig } from "@/lib/scrape-runs";
import { EXPECTED_EXTENSION_VERSION, extensionVersionFromRequest, isCompatibleExtensionVersion } from "@/lib/extension-heartbeat";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization"), request))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  if (!(await facebookWorkAllowed(request))) {
    return withCors(json({ groups: [], scrapeAllowed: false, accountPaused: true, upgradeRequired: false, expectedVersion: EXPECTED_EXTENSION_VERSION, message: "บัญชีนี้ถูกหยุดงานจากหน้าจัดการบัญชี" }));
  }
  const config = await buildExtensionConfig();
  const version = extensionVersionFromRequest(request);
  if (!isCompatibleExtensionVersion(version)) {
    return withCors(
      json({
        ...config,
        groups: [],
        scrapeAllowed: false,
        upgradeRequired: true,
        expectedVersion: EXPECTED_EXTENSION_VERSION,
        message: `ส่วนขยายเวอร์ชัน ${version || "เก่า"} ถูกระงับการอ่าน — อัปเดตเป็น ${EXPECTED_EXTENSION_VERSION}`,
      }),
    );
  }
  return withCors(json({ ...config, scrapeAllowed: true, upgradeRequired: false, expectedVersion: EXPECTED_EXTENSION_VERSION }));
}
