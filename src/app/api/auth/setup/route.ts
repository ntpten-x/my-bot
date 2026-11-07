import { timingSafeEqual } from "node:crypto";
import { isLocalRequest } from "@/lib/request-security";
import { z } from "zod";
import { cookieOptions, createOwner, createSession, ownerExists, SESSION_COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";
import { passwordProblems } from "@/lib/password-policy";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  password: z.string().max(200).min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัว"),
  confirm: z.string().max(200), bootstrapToken: z.string().max(256).optional(),
});

export async function POST(request: Request) {
  if (await ownerExists()) return json({ error: "ตั้งรหัสผ่านไปแล้ว" }, 409);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" }, 400);
  if (!isLocalRequest(request.headers, request.url)) {
    const expected = Buffer.from(process.env.BOOTSTRAP_TOKEN || ""), given = Buffer.from(parsed.data.bootstrapToken || "");
    if (expected.length < 24 || given.length !== expected.length || !timingSafeEqual(expected, given)) return json({ error: "ต้องใช้รหัสตั้งระบบครั้งแรกจาก environment ของเซิร์ฟเวอร์" }, 403);
  }
  if (parsed.data.password !== parsed.data.confirm) return json({ error: "รหัสผ่านไม่ตรงกัน" }, 400);
  const problems = passwordProblems(parsed.data.password);
  if (problems.length) return json({ error: `รหัสผ่านยังไม่ปลอดภัย: ต้อง${problems.join(", ")}`, problems }, 400);
  const owner = await createOwner(parsed.data.password);
  const token = await createSession(owner.id);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(request));
  return response;
}
