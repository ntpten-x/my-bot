import { prisma } from "@/lib/prisma";

type Scope = { boundCategorySlug?: string; defaultProductId?: string | null };

/** Keep the owner's category/type binding consistent across both source entry points. */
export async function resolveSourceScope(input: Scope, current?: { boundCategorySlug: string; defaultProductId: string | null }) {
  const category = input.boundCategorySlug ?? current?.boundCategorySlug ?? "";
  if (category && !(await prisma.category.findFirst({ where: { slug: category, parentId: null } }))) {
    return { error: "ไม่พบหมวดหมู่นี้ กรุณาเลือกใหม่" } as const;
  }
  let productId = input.defaultProductId === undefined ? current?.defaultProductId ?? null : input.defaultProductId;
  if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return { error: "ไม่พบประเภทนี้ กรุณาเลือกใหม่" } as const;
    if (product.categorySlug !== category) {
      // Changing only the category clears the previous type. Explicit mismatches are rejected.
      if (input.defaultProductId === undefined && input.boundCategorySlug !== undefined) productId = null;
      else return { error: "ประเภทต้องอยู่ภายใต้หมวดหมู่ที่เลือก" } as const;
    }
  }
  return { scope: { boundCategorySlug: category, defaultProductId: productId } } as const;
}
