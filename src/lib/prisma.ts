import "./load-env";
import { PrismaClient } from "@prisma/client";

// Connection codes where the query never ran (safe to retry any operation), and codes where a
// read can be retried (the connection dropped mid-flight).
const NOT_SENT = new Set(["P1001", "P1002", "P2024"]);
const READ_RETRY = new Set(["P1008", "P1017", "P2034"]);
const READS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "$queryRaw"]);

export const dbErrorStats = { transient: 0, retried: 0, lastAt: 0, lastCode: "" };

/** Pool settings for Supabase: the 6543 pooler is pgbouncer (transaction mode). Existing URL params win. */
export function tuneDatabaseUrl(url: string | undefined, env: NodeJS.ProcessEnv = process.env) {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    const pooled = parsed.searchParams.get("pgbouncer") === "true" || parsed.port === "6543";
    if (pooled && !parsed.searchParams.has("pgbouncer")) parsed.searchParams.set("pgbouncer", "true");
    if (!parsed.searchParams.has("connection_limit")) parsed.searchParams.set("connection_limit", env.DB_CONNECTION_LIMIT || (pooled ? "8" : "10"));
    if (!parsed.searchParams.has("pool_timeout")) parsed.searchParams.set("pool_timeout", "20");
    if (!parsed.searchParams.has("connect_timeout")) parsed.searchParams.set("connect_timeout", "15");
    return parsed.toString();
  } catch {
    return url;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function makeClient() {
  const base = new PrismaClient({
    datasourceUrl: tuneDatabaseUrl(process.env.DATABASE_URL),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
  });
  return base.$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        for (let attempt = 0; ; attempt += 1) {
          try {
            return await query(args);
          } catch (error) {
            const code = String((error as { code?: string; errorCode?: string }).code || (error as { errorCode?: string }).errorCode || "");
            const transient = NOT_SENT.has(code) || READ_RETRY.has(code);
            if (transient) Object.assign(dbErrorStats, { transient: dbErrorStats.transient + 1, lastAt: Date.now(), lastCode: code });
            const retryable = NOT_SENT.has(code) || (READ_RETRY.has(code) && READS.has(operation));
            if (!retryable || attempt >= 2) throw error;
            dbErrorStats.retried += 1;
            await sleep(400 * 3 ** attempt);
          }
        }
      },
    },
  }) as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;