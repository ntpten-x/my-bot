/** Manual backup: npm run db:backup  ->  data/backups/manual-<timestamp>.json.gz */
import { backupDatabase } from "../src/lib/backup";
import { prisma } from "../src/lib/prisma";

backupDatabase(`manual-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`)
  .then((file) => console.log(`Backup created: ${file}`))
  .catch((error) => { console.error("[backup]", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/[^\s"']+/g, "postgresql://***") : error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());