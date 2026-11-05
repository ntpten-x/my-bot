-- AlterTable
ALTER TABLE "ReplyTemplate" ADD COLUMN     "productId" TEXT,
ADD COLUMN     "sourceIds" TEXT NOT NULL DEFAULT '';

-- AddForeignKey
ALTER TABLE "ReplyTemplate" ADD CONSTRAINT "ReplyTemplate_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

