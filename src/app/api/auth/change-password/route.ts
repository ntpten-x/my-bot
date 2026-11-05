import bcrypt from "bcryptjs";
import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { clientIp, verifyPassword } from "@/lib/auth";
import { checkLogin, recordLogin } from "@/lib/login-guard";
import { dbGuardStore } from "@/lib/login-guard-db";
import { passwordProblems } from "@/lib/password-policy";
import { isPasswordWeakFlagged, setPasswordWeak } from "@/lib/password-flag";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ current: z.string().min(1).max(200), next: z.string().max(200), confirm: z.string().max(200) });

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  return json({ weak: await isPasswordWeakFlagged() });
}

export async function POST(request: Request) {
  const { session, error } = await authed();
  if (error) return error;
  const ip = clientIp(request.headers.get("x-forwarded-for"));
  if ((await checkLogin(dbGuardStore, ip)) > 0) return json({ error: "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่" }, 429);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "กรอกข้อมูลให้ครบ" }, 400);
  const { current, next, confirm } = parsed.data;
  if (next !== confirm) return json({ error: "รหัสผ่านใหม่ไม่ตรงกัน" }, 400);
  if (next === current) return json({ error: "รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม" }, 400);
  const problems = passwordProblems(next);
  if (problems.length) return json({ error: `รหัสผ่านใหม่ยังไม่ปลอดภัย: ต้อง${problems.join(", ")}`, problems }, 400);
  const owner = await verifyPassword(current);
  await recordLogin(dbGuardStore, ip, Boolean(owner));
  if (!owner) return json({ error: "รหัสผ่านเดิมไม่ถูกต้อง" }, 401);
  await prisma.owner.update({ where: { id: owner.id }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  // Sign out every other browser; keep this one.
  await prisma.session.deleteMany({ where: { ownerId: owner.id, NOT: { id: session!.id } } });
  await setPasswordWeak(false);
  return json({ ok: true });
}