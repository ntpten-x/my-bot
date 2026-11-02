import { prisma } from "../src/lib/prisma";

async function main() {
  const sources = await prisma.source.findMany({
    where: {
      enabled: false,
      OR: [{ url: { contains: "mybot-demo" } }, { name: { contains: "ตัวอย่าง" } }],
    },
    select: { id: true, name: true, url: true },
  });
  if (!sources.length) {
    console.log("ไม่พบแหล่งตัวอย่างที่ปิดอยู่");
    return;
  }
  const deleted = await prisma.post.deleteMany({ where: { sourceId: { in: sources.map((source) => source.id) } } });
  for (const source of sources) console.log(`ลบโพสต์ของ ${source.name} (${source.url})`);
  console.log(`ลบโพสต์ตัวอย่าง ${deleted.count} รายการ`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
