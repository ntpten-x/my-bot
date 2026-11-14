-- Matches the default owner feed order and excludes rows hidden by default.
CREATE INDEX "Post_default_feed_order_idx" ON "Post" ("sortAt" DESC NULLS LAST, "createdAt" DESC, "id" ASC)
WHERE "isAd" = false AND "forbiddenHit" = false AND "dismissed" = false AND "duplicateOfId" IS NULL;
