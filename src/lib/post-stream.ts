import type { Prisma } from "@prisma/client";

export type PostStreamCursor = { createdAt: Date; id: string | null };
// A timestamp alone drops rows when one ingest batch creates >20 posts in the same millisecond.
export function postStreamWhere(cursor: PostStreamCursor): Prisma.PostWhereInput {
  return { duplicateOfId: null, dismissed: false, ...(cursor.id === null
    ? { createdAt: { gte: cursor.createdAt } }
    : { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }) };
}
