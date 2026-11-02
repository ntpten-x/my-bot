import { prisma } from "../src/lib/prisma";
import { maskSecret } from "../src/lib/seed-policy";

async function main() {
  const row = await prisma.setting.findUnique({ where: { key: "extension_token" } });
  if (!row?.value) {
    console.log("NO_TOKEN");
    process.exitCode = 1;
    return;
  }
  console.log(maskSecret(row.value));
  console.log("Full token is on the Settings page only.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
