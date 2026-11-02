ALTER TABLE "Post" ADD COLUMN "extraUrlsJson" TEXT NOT NULL DEFAULT '[]';

UPDATE "Category"
SET "matchWords" = trim("matchWords" || ', คิวว่าง, เริ่มส่ง, เมนู')
WHERE "slug" = 'food' AND instr("matchWords", 'คิวว่าง') = 0;
