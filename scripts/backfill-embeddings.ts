import { backfillEmbeddings } from "../src/lib/smart/backfill";
import { prisma } from "../src/lib/prisma";

async function main() {
  let remaining = 1;
  let total = 0;
  while (remaining > 0) {
    const result = await backfillEmbeddings(20);
    total += result.filled;
    remaining = result.remaining;
    console.log(`เติมแล้วชุดนี้ ${result.filled} เหลือ ${result.remaining}`);
    if (result.tried === 0 || result.filled === 0) break;
  }
  console.log(`เสร็จ เติม embedding ได้ ${total} โพสต์`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
