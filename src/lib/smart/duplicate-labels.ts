import { prisma } from "../prisma";

/**
 * Duplicates (same text posted again or in another group) take the original's labels and ad flag,
 * so one copy cannot be "seller 44" while the other is an ad scored 8. Posts the owner relabelled are kept.
 */
export async function syncDuplicateLabels() {
  return prisma.$executeRaw`
    UPDATE "Post" AS d SET
      "categoryId" = o."categoryId",
      "subcategoryId" = o."subcategoryId",
      "intent" = o."intent",
      "isAd" = o."isAd",
      "province" = COALESCE(o."province", d."province"),
      "score" = o."score",
      "scoreReason" = o."scoreReason",
      "aiProvider" = 'dup:' || COALESCE(o."aiProvider", 'rules')
    FROM "Post" AS o
    WHERE d."duplicateOfId" = o."id"
      AND COALESCE(d."aiProvider", '') <> 'owner'
      AND (d."categoryId" IS DISTINCT FROM o."categoryId"
        OR d."subcategoryId" IS DISTINCT FROM o."subcategoryId"
        OR d."intent" <> o."intent"
        OR d."isAd" <> o."isAd"
        OR d."score" <> o."score")`;
}
