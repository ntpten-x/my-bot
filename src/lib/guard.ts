import { getSession } from "./auth";
import { mfaRequiredForAccess, sessionIsRecent } from "./session-policy";
import { json } from "./http";

export async function authed(options: { recent?: boolean; allowMfaSetup?: boolean } = {}) {
  const session = await getSession();
  if (!session) return { session: null, error: json({ error: "กรุณาเข้าสู่ระบบ" }, 401) };
  if (mfaRequiredForAccess() && !session.mfaEnabled && !options.allowMfaSetup) return { session: null, error: json({ error: "กรุณาตั้งค่า MFA ที่หน้าความปลอดภัยก่อนใช้งาน", code: "MFA_SETUP_REQUIRED" }, 403) };
  if (options.recent && !sessionIsRecent(session)) return { session: null, error: json({ error: "กรุณายืนยันตัวตนอีกครั้งที่หน้าความปลอดภัย", code: "REAUTH_REQUIRED" }, 403) };
  return { session, error: null };
}
