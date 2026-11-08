import type { Prisma } from "@prisma/client";

export const TYPE_SETUP_PREFIX = "auto_comment_type_setup_";
export type TypeSetup = { productId: string; templateIds: string[] };
export function readTypeSetup(value: string | undefined | null): TypeSetup | null {
  if (!value) return null;
  try { const data = JSON.parse(value); return typeof data.productId === "string" && Array.isArray(data.templateIds) && data.templateIds.every((id: unknown) => typeof id === "string") ? data : null; } catch { return null; }
}
export async function commentTypeAllowed(tx: Pick<Prisma.TransactionClient, "setting" | "product">, ruleId: string, source: { defaultProductId: string | null; boundCategorySlug: string }) {
  const stored = await tx.setting.findUnique({ where: { key: `${TYPE_SETUP_PREFIX}${ruleId}` } });
  if (!stored) return true; // Legacy rules retain their explicit allowlist.
  const setup = readTypeSetup(stored.value);
  if (!setup || source.defaultProductId !== setup.productId) return false;
  const product = await tx.product.findUnique({ where: { id: setup.productId } });
  return Boolean(product?.enabled && product.categorySlug === source.boundCategorySlug);
}
