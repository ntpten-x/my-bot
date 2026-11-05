import { z } from "zod";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { postInclude, serializePost, withAlsoIn } from "@/lib/serialize";

export const dynamic = "force-dynamic";

const schema = z.object({
  categoryId: z.string().min(1).nullable(),
  subcategoryId: z.string().min(1).nullable().optional(),
  intent: z.enum(["buyer", "seller", "ad", "chat", "unknown"]).optional(),
  /** Game/product (level 3); null = "ไม่ระบุ", omitted = keep. */
  productId: z.string().min(1).nullable().optional(),
});

/** "หมวดผิด": the owner picks the right category/intent; stored as ground truth and the AI never overwrites it. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed();
  if (error) return error;
  const { id } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "ข้อมูลไม่ถูกต้อง" }, 400);
  const post = await prisma.post.findUnique({ where: { id }, include: { category: true, subcategory: true, product: true } });
  if (!post) return json({ error: "ไม่พบประกาศ" }, 404);
  const ids = [parsed.data.categoryId, parsed.data.subcategoryId].filter((value): value is string => Boolean(value));
  const cats = ids.length ? await prisma.category.findMany({ where: { id: { in: ids } } }) : [];
  const category = cats.find((row) => row.id === parsed.data.categoryId) ?? null;
  const sub = cats.find((row) => row.id === parsed.data.subcategoryId) ?? null;
  if (parsed.data.categoryId && !category) return json({ error: "ไม่พบหมวดนี้" }, 400);
  if (sub && sub.parentId !== category?.id) return json({ error: "หมวดย่อยไม่ตรงกับหมวดหลัก" }, 400);
  const intent = parsed.data.intent ?? post.intent;
  const productChanged = parsed.data.productId !== undefined;
  const product = parsed.data.productId ? await prisma.product.findUnique({ where: { id: parsed.data.productId } }) : null;
  if (parsed.data.productId && !product) return json({ error: "ไม่พบเกม/สินค้านี้" }, 400);
  const toProduct = productChanged ? product : post.product;
  await prisma.$transaction([
    prisma.labelCorrection.create({
      data: {
        postId: post.id,
        sourceId: post.sourceId,
        fromCategory: post.category?.slug ?? "",
        fromSubcategory: post.subcategory?.slug ?? "",
        fromIntent: post.intent,
        fromProvider: post.aiProvider ?? "",
        toCategory: category?.slug ?? "",
        toSubcategory: sub?.slug ?? "",
        toIntent: intent,
        fromProduct: post.product?.slug ?? "",
        toProduct: toProduct?.slug ?? "",
      },
    }),
    prisma.post.update({
      where: { id },
      data: {
        categoryId: category?.id ?? null,
        subcategoryId: sub?.id ?? null,
        intent,
        ...(intent === "ad" ? { isAd: true } : post.isAd ? { isAd: false } : {}),
        aiProvider: "owner",
        ...(productChanged ? { productId: product?.id ?? null, productBy: "owner" } : {}),
      },
    }),
  ]);
  const fresh = await prisma.post.findUnique({ where: { id }, include: postInclude });
  if (!fresh) return json({ error: "ไม่พบประกาศ" }, 404);
  return json({ post: (await withAlsoIn([serializePost(fresh)]))[0] });
}
