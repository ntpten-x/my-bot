import bcrypt from "bcryptjs";
import { z } from "zod";
import { clientIp, cookieOptions, createSession, ownerExists, SESSION_COOKIE } from "@/lib/auth";
import { bootstrapTokenErrorMessage, bootstrapTokenOk } from "@/lib/bootstrap-token";
import { json } from "@/lib/http";
import { checkLogin, recordLogin } from "@/lib/login-guard";
import { dbGuardStore } from "@/lib/login-guard-db";
import { setPasswordWeak } from "@/lib/password-flag";
import { passwordProblems } from "@/lib/password-policy";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  bootstrapToken: z.string().max(256).optional(),
  password: z.string().max(200).min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัว"),
  confirm: z.string().max(200),
});

function locked(waitMs: number) {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  const response = json({ error: `ใส่รหัสผิดหลายครั้ง ล็อกไว้ชั่วคราว ลองใหม่ในอีก ${minutes} นาที` }, 429);
  response.headers.set("Retry-After", String(Math.ceil(waitMs / 1000)));
  return response;
}

export async function POST(request: Request) {
  if (!(await ownerExists())) return json({ error: "ยังไม่ได้ตั้งรหัสผ่าน", needsSetup: true }, 409);
  const ip = clientIp(request.headers.get("x-forwarded-for"));
  const wait = await checkLogin(dbGuardStore, ip);
  if (wait > 0) return locked(wait);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "กรอกข้อมูลให้ครบ" }, 400);
  if (parsed.data.password !== parsed.data.confirm) return json({ error: "รหัสผ่านไม่ตรงกัน" }, 400);
  const problems = passwordProblems(parsed.data.password);
  if (problems.length) return json({ error: `รหัสผ่านยังไม่ปลอดภัย: ต้อง${problems.join(", ")}`, problems }, 400);

  const tokenOk = bootstrapTokenOk(request, parsed.data.bootstrapToken);
  await recordLogin(dbGuardStore, ip, tokenOk);
  if (!tokenOk) {
    const after = await checkLogin(dbGuardStore, ip);
    return after > 0 ? locked(after) : json({ error: bootstrapTokenErrorMessage() }, 403);
  }

  const owner = await prisma.owner.findFirst();
  if (!owner) return json({ error: "ยังไม่ได้ตั้งรหัสผ่าน", needsSetup: true }, 409);

  await prisma.owner.update({
    where: { id: owner.id },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, 12) },
  });
  await prisma.session.deleteMany({ where: { ownerId: owner.id } });
  await setPasswordWeak(false);

  const sessionToken = await createSession(owner.id);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, sessionToken, cookieOptions(request));
  return response;
}
