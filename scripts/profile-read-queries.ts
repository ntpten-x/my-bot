import "../src/lib/load-env";
import { PrismaClient } from "@prisma/client";
const queries = [
  { name: "default_feed", sql: `SELECT id,text FROM "Post" WHERE "isAd"=false AND "forbiddenHit"=false AND dismissed=false AND "duplicateOfId" IS NULL ORDER BY "sortAt" DESC NULLS LAST,"createdAt" DESC,id ASC LIMIT 30` },
  { name: "unread_badge", sql: `SELECT count(*) FROM "Notification" WHERE read=false AND channel='in_app'` },
];
async function main() {
  if (!process.argv.includes("--db")) { console.log(JSON.stringify({ mode: "dry-run", queries: queries.map(q => q.name), executesStatements: false })); return; }
  const db = new PrismaClient();
  try {
    for (const query of queries) {
      // Statements are fixed source constants, never request/user input. No ANALYZE (no execution).
      const [row] = await db.$queryRawUnsafe<Array<Record<string, Array<{ Plan: { "Node Type": string; "Total Cost": number; "Plan Rows": number } }>>>>(`EXPLAIN (FORMAT JSON) ${query.sql}`);
      const plan = row["QUERY PLAN"][0].Plan;
      console.log(JSON.stringify({ name: query.name, node: plan["Node Type"], estimatedCost: plan["Total Cost"], estimatedRows: plan["Plan Rows"], measuredLatency: false }));
    }
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("FAIL query plan inspection (database details withheld)"); process.exitCode = 1; });
