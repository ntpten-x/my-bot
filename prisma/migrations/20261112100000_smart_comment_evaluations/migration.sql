-- Additive only: existing rules retain keyword behavior and existing consent.
ALTER TABLE "AutoCommentRule" ADD COLUMN "intentMode" TEXT NOT NULL DEFAULT 'keyword',
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "AutoCommentEvaluation" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "generation" TEXT NOT NULL,
  "postUpdatedAt" TIMESTAMP(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "rulesFingerprint" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "reasonsJson" TEXT NOT NULL DEFAULT '[]',
  "nextEvaluateAt" TIMESTAMP(3),
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutoCommentEvaluation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutoCommentEvaluation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AutoCommentEvaluation_generation_postId_key" ON "AutoCommentEvaluation"("generation", "postId");
CREATE INDEX "AutoCommentEvaluation_state_nextEvaluateAt_idx" ON "AutoCommentEvaluation"("state", "nextEvaluateAt");
ALTER TABLE "AutoCommentEvaluation" ENABLE ROW LEVEL SECURITY;
