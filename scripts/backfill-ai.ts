import { enqueueUnclassifiedPosts } from "../src/lib/ai/queue";
import { prisma } from "../src/lib/prisma";

async function main() {
  const count = await enqueueUnclassifiedPosts(true);
  console.log(`เข้าคิวจัดหมวดใหม่ ${count} โพสต์ที่ยังเป็น rules หรือยังไม่เคยผ่าน AI`);
  console.log("ให้ worker ที่รันอยู่ประมวลผลคิวนี้ ถ้ารีสตาร์ตแอป ตอนเปิด worker จะเข้าคิวให้เอง");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
