-- Feed sort key: post time, falling back to capture time. Maintained by Postgres.
ALTER TABLE "Post" ADD COLUMN "sortAt" TIMESTAMP(3) GENERATED ALWAYS AS (COALESCE("postedAt", "createdAt")) STORED;
CREATE INDEX "Post_sortAt_idx" ON "Post"("sortAt" DESC);
