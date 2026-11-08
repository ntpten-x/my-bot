import { prisma } from "@/lib/prisma";

/** Category-scoped and product-scoped messages share the existing template store. */
export async function templateScopeError(categoryId: string | null | undefined, productId: string | null | undefined) {
  const category = categoryId ? await prisma.category.findUnique({ where: { id: categoryId }, select: { id: true, slug: true, parent: { select: { slug: true } } } }) : null;
  if (categoryId && !category) return "ไม่พบหมวดหมู่นี้ กรุณาเลือกใหม่";
  if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { categorySlug: true } });
    if (!product) return "ไม่พบประเภทนี้ กรุณาเลือกใหม่";
    if (category && product.categorySlug !== (category.parent?.slug ?? category.slug)) return "ประเภทต้องอยู่ภายใต้หมวดหมู่ที่เลือก";
  }
  return null;
}
