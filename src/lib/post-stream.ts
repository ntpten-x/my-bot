import type { Prisma } from "@prisma/client";

export type PostStreamCursor = { createdAt: Date; id: string | null };

/** Overlap window so a late-committing earlier createdAt is not missed by a fresh SSE cursor. */
export const POST_STREAM_OVERLAP_MS = 15_000;
export const POST_STREAM_POLL_MS = 2_500;
export const POST_STREAM_FULL_POLL_MS = 100;
export const POST_STREAM_SESSION_CHECK_MS = 10_000;
export const POST_STREAM_MAX_MS = 5 * 60_000;

export function initialPostStreamCursor(now = Date.now()): PostStreamCursor {
  return { createdAt: new Date(now - POST_STREAM_OVERLAP_MS), id: null };
}

// A timestamp alone drops rows when one ingest batch creates >20 posts in the same millisecond.
export function postStreamWhere(cursor: PostStreamCursor): Prisma.PostWhereInput {
  return { duplicateOfId: null, dismissed: false, ...(cursor.id === null
    ? { createdAt: { gte: cursor.createdAt } }
    : { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] }) };
}
