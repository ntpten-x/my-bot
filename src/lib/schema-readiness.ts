import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const REQUIRED = [
  ["Post", "textRevision"], ["AiJob", "claimToken"], ["Lease", "expiresAt"],
  ["AutoCommentRule", "id"], ["AutoCommentTemplate", "id"], ["AutoCommentJob", "id"], ["AutoCommentLog", "id"],
  ["AutoCommentRule", "deliveryMode"], ["AutoCommentRule", "browserDeviceId"], ["AutoCommentRule", "browserFbUserId"],
  ["AutoCommentRule", "browserConsent"], ["AutoCommentRule", "requireAi"], ["AutoCommentRule", "messageMode"],
  ["AutoCommentJob", "deliveryMode"], ["AutoCommentJob", "browserDeviceId"], ["AutoCommentJob", "browserFbUserId"],
] as const;

/** Read-only catalog inspection. No keys, URLs or user rows are returned. */
export async function schemaReadiness(db: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma) {
  const expected = Prisma.join(REQUIRED.map(([table, column]) => Prisma.sql`(${table}::text, ${column}::text)`));
  const rows = await db.$queryRaw<{ table_name: string; column_name: string; present: boolean }[]>(Prisma.sql`
    SELECT expected.table_name, expected.column_name, EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema=current_schema() AND c.table_name=expected.table_name AND c.column_name=expected.column_name
    ) AS present FROM (VALUES ${expected}) AS expected(table_name,column_name)
  `);
  const present = new Set(rows.filter(row => row.present).map(row => `${row.table_name}.${row.column_name}`));
  const missing = REQUIRED.map(([table, column]) => `${table}.${column}`).filter(name => !present.has(name));
  return { ready: !missing.length, missing };
}
