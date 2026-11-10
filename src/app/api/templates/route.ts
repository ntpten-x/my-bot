import { templateScopeError } from "@/lib/template-scope";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { MAX_TEMPLATES, templateSchema } from "@/lib/automation-schema";
import { withMessageImageUrls } from "@/lib/supabase-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const templates = await prisma.replyTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { useCount: "desc" }, { createdAt: "asc" }] });
  return json({ templates: await withMessageImageUrls(templates), max: MAX_TEMPLATES });
}

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = templateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ใส่ชื่อและข้อความ (ไม่เกิน 2,000 ตัวอักษร)" }, 400);
  if ((await prisma.replyTemplate.count()) >= MAX_TEMPLATES) return json({ error: `เก็บได้สูงสุด ${MAX_TEMPLATES} ข้อความ` }, 400);
  const scopeError = await templateScopeError(parsed.data.categoryId, parsed.data.productId);
  if (scopeError) return json({ error: scopeError }, 400);
  const { sourceIds, ...rest } = parsed.data;
  const template = await prisma.replyTemplate.create({
    data: { ...rest, categoryId: rest.categoryId || null, productId: rest.productId || null, sourceIds: (sourceIds ?? []).join(",") },
  });
  return json({ template: { ...template, imageUrl: null } });
}
