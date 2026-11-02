import { z } from "zod";
import { cookieOptions, createOwner, createSession, ownerExists, SESSION_COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  password: z.string().min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัว"),
  confirm: z.string(),
});

export async function POST(request: Request) {
  if (await ownerExists()) return json({ error: "ตั้งรหัสผ่านไปแล้ว" }, 409);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" }, 400);
  if (parsed.data.password !== parsed.data.confirm) return json({ error: "รหัสผ่านไม่ตรงกัน" }, 400);
  const owner = await createOwner(parsed.data.password);
  const token = await createSession(owner.id);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, cookieOptions());
  return response;
}
