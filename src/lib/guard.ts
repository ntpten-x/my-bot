import { getSession } from "./auth";
import { json } from "./http";

export async function authed() {
  const session = await getSession();
  if (!session) return { session: null, error: json({ error: "กรุณาเข้าสู่ระบบ" }, 401) };
  return { session, error: null };
}
