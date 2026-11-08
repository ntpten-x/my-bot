import type { Prisma } from "@prisma/client";
export const RULE_ARCHIVE_PREFIX = "auto_comment_rule_deleted_";
export async function ruleArchived(tx: Pick<Prisma.TransactionClient, "setting">, id: string) {
  return (await tx.setting.findUnique({ where: { key: `${RULE_ARCHIVE_PREFIX}${id}` } }))?.value === "1";
}
