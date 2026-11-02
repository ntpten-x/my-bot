import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ruleSchema } from "@/lib/automation-schema";
import { MAX_RULES } from "@/lib/automation";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const rules = await prisma.automationRule.findMany({ orderBy: { createdAt: "asc" } });
  return json({ rules, max: MAX_RULES });
}

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = ruleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลกฎไม่ถูกต้อง" }, 400);
  if ((await prisma.automationRule.count()) >= MAX_RULES) return json({ error: `สร้างกฎได้สูงสุด ${MAX_RULES} กฎ` }, 400);
  const rule = await prisma.automationRule.create({
    data: { ...parsed.data, categoryId: parsed.data.categoryId || null, templateId: parsed.data.templateId || null },
  });
  return json({ rule });
}
