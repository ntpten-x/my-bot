import { z } from "zod";
import { authed } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/http";
import { ACCOUNT_PAUSE_PREFIX, validFacebookId } from "@/lib/facebook-accounts";

export const dynamic = "force-dynamic";
const schema = z.object({ enabled: z.boolean() }).strict();
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed(); if (error) return error;
  const { id } = await context.params;
  if (!validFacebookId(id)) return json({ error: "รหัสบัญชีไม่ถูกต้อง" }, 400);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "เลือกเปิดหรือหยุดทำงาน" }, 400);
  if (!(await prisma.fbAccount.findUnique({ where: { id }, select: { id: true } }))) return json({ error: "ไม่พบบัญชีนี้" }, 404);
  const key = `${ACCOUNT_PAUSE_PREFIX}${id}`, value = parsed.data.enabled ? "0" : "1";
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return json({ ok: true, enabled: parsed.data.enabled });
}
