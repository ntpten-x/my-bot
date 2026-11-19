import "../src/lib/load-env";
import { prisma } from "../src/lib/prisma";
import { collapseTruncatedCaptures } from "../src/lib/smart/enrich";

async function main() {
  const linked = await collapseTruncatedCaptures();
  console.log(`Repaired ${linked} truncated capture duplicate(s).`);
}

main()
  .catch(() => {
    console.error("Collapse capture maintenance failed.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
