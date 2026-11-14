import { readJson } from "@/lib/request-body";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { ruleData, ruleSchema } from "@/lib/automation-schema";
import { MAX_RULES } from "@/lib/automation";
import { ruleQueueStats } from "@/lib/reply-queue";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const rules = await prisma.automationRule.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  return json({ rules, max: MAX_RULES, stats: await ruleQueueStats() });
}

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = ruleSchema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลกฎไม่ถูกต้อง" }, 400);
  if ((await prisma.automationRule.count()) >= MAX_RULES) return json({ error: `สร้างกฎได้สูงสุด ${MAX_RULES} กฎ` }, 400);
  const rule = await prisma.automationRule.create({
    data: ruleData(parsed.data),
  });
  return json({ rule });
}
