import { readJson } from "@/lib/request-body";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .slice(0, 48);
  return base || `cat-${Date.now().toString(36)}`;
}

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const categories = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return json({
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
      matchWords: category.matchWords,
      sortOrder: category.sortOrder,
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  parentId: z.string().nullable().optional(),
  matchWords: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const parsed = createSchema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return json({ error: "ตั้งชื่อหมวดก่อน" }, 400);
  let slug = slugify(parsed.data.name);
  const exists = await prisma.category.findUnique({ where: { slug } });
  if (exists) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const count = await prisma.category.count();
  const category = await prisma.category.create({
    data: {
      name: parsed.data.name.trim(),
      slug,
      parentId: parsed.data.parentId || null,
      matchWords: parsed.data.matchWords?.trim() ?? "",
      sortOrder: count + 1,
    },
  });
  return json({ category });
}
