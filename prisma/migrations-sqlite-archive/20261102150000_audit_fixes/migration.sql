-- AlterTable
ALTER TABLE "AiJob" ADD COLUMN "latencyMs" INTEGER;

-- New categories for databases created before this release
INSERT INTO "Category" ("id", "name", "slug", "parentId", "matchWords", "sortOrder", "createdAt")
SELECT lower(hex(randomblob(12))), 'อาหาร', 'food', NULL, 'อาหาร, ก๋วยเตี๋ยว, ข้าวมันไก่, คาเฟ่, กาแฟ, ขนม, เครื่องดื่ม, ร้านอาหาร, สั่งอาหาร, ของกิน', 20, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'food');

INSERT INTO "Category" ("id", "name", "slug", "parentId", "matchWords", "sortOrder", "createdAt")
SELECT lower(hex(randomblob(12))), 'บริการ', 'services', NULL, 'ล้างแอร์, แม่บ้าน, รับซ่อม, ทำความสะอาด, ช่างแอร์, บริการ, ช่างประปา, รับจ้างทำความสะอาด', 21, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'services');

INSERT INTO "Category" ("id", "name", "slug", "parentId", "matchWords", "sortOrder", "createdAt")
SELECT lower(hex(randomblob(12))), 'เดินทาง', 'travel', NULL, 'ตั๋วเครื่องบิน, ทัวร์, เดินทาง, รับส่งสนามบิน, รถตู้, ที่พัก, ตั๋วรถ, สนามบิน', 22, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Category" WHERE "slug" = 'travel');

UPDATE "Category"
SET "matchWords" = trim("matchWords" || ', ipad, ไอแพด, แท็บเล็ต, tablet, samsung, มือถือ, โทรศัพท์')
WHERE "slug" = 'it' AND instr(lower("matchWords"), 'ipad') = 0;
