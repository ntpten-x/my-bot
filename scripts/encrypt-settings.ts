import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { encodeSetting, legacySecret, SECRET_SETTING_KEYS } from "../src/lib/setting-secrets";
import { hasKeySecret } from "../src/lib/ai/secret-box";

async function main() {
  if (!hasKeySecret()) throw new Error("AI_KEY_SECRET is required");
  const rows = await prisma.setting.findMany({ where: { key: { in: [...SECRET_SETTING_KEYS] } } });
  let changed = 0;
  for (const row of rows) {
    if (!legacySecret(row.key, row.value)) continue;
    const result = await prisma.setting.updateMany({ where: { key: row.key, value: row.value }, data: { value: encodeSetting(row.key, row.value) } });
    changed += result.count;
  }
  console.log(`Encrypted settings: ${changed}. No values printed.`);
}
main().catch(() => { console.error("Encryption failed. Check AI_KEY_SECRET and database access; values hidden."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
