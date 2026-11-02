import { z } from "zod";
import { allowLogin, clientIp, cookieOptions, createSession, ownerExists, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ password: z.string().min(1) });

export async function POST(request: Request) {
  if (!(await ownerExists())) return json({ error: "ยังไม่ได้ตั้งรหัสผ่าน", needsSetup: true }, 409);
  const ip = clientIp(request.headers.get("x-forwarded-for"));
  if (!allowLogin(ip)) return json({ error: "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่" }, 429);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "กรอกรหัสผ่าน" }, 400);
  const owner = await verifyPassword(parsed.data.password);
  if (!owner) return json({ error: "รหัสผ่านไม่ถูกต้อง" }, 401);
  const token = await createSession(owner.id);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return response;
}
