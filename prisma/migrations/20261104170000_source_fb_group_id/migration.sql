-- Numeric Facebook group id learned from the page, so vanity and numeric group URLs map to one source.
ALTER TABLE "Source" ADD COLUMN "fbGroupId" TEXT;
CREATE INDEX "Source_fbGroupId_idx" ON "Source"("fbGroupId");
