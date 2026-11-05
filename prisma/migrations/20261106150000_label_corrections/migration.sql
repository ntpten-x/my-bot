-- Owner label corrections ("หมวดผิด") for per-group accuracy.
CREATE TABLE "LabelCorrection" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fromCategory" TEXT NOT NULL DEFAULT '',
    "fromSubcategory" TEXT NOT NULL DEFAULT '',
    "fromIntent" TEXT NOT NULL DEFAULT '',
    "fromProvider" TEXT NOT NULL DEFAULT '',
    "toCategory" TEXT NOT NULL DEFAULT '',
    "toSubcategory" TEXT NOT NULL DEFAULT '',
    "toIntent" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabelCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LabelCorrection_sourceId_createdAt_idx" ON "LabelCorrection"("sourceId", "createdAt");
CREATE INDEX "LabelCorrection_postId_idx" ON "LabelCorrection"("postId");
ALTER TABLE "LabelCorrection" ADD CONSTRAINT "LabelCorrection_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- New games sub-category "คนกลาง" (middleman), only where the games category exists.
INSERT INTO "Category" ("id", "name", "slug", "parentId", "matchWords", "sortOrder", "createdAt")
SELECT 'cat_game_middleman', 'คนกลาง', 'game-middleman', g."id", 'คนกลาง,กลางเครดิต,หากลาง,รับกลาง,ตัวกลาง',
       COALESCE((SELECT MAX("sortOrder") FROM "Category" WHERE "parentId" = g."id"), 0) + 1, CURRENT_TIMESTAMP
FROM "Category" g WHERE g."slug" = 'games' AND g."parentId" IS NULL
ON CONFLICT ("slug") DO NOTHING;
