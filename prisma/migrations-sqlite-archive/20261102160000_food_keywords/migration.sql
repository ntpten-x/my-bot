UPDATE "Category"
SET "matchWords" = trim("matchWords" || ', ยำ, ลูกชิ้น, ส้มตำ, กับข้าว, ของกิน')
WHERE "slug" = 'food' AND instr("matchWords", 'ลูกชิ้น') = 0;
