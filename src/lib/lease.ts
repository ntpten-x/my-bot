import os from "node:os";
import { randomUUID } from "node:crypto";
import { prisma } from "./prisma";

// Local MY-BOT and Render share one database. Background jobs (AI queue, alerts, summaries,
// scheduler) run only on the instance that holds the "worker" lease.
export const INSTANCE_ID = `${process.env.RENDER ? "render" : os.hostname()}:${process.pid}:${randomUUID().slice(0, 6)}`.slice(0, 80);
export const WORKER_LEASE = "worker";
export const WORKER_LEASE_MS = 150_000;

/** Take or renew a lease atomically. True when this instance holds it afterwards. */
export async function acquireLease(name: string, ttlMs: number, holder = INSTANCE_ID): Promise<boolean> {
  const seconds = Math.max(1, ttlMs / 1000);
  const rows = await prisma.$queryRaw<{ holder: string }[]>`
    INSERT INTO "Lease" ("name", "holder", "expiresAt", "updatedAt")
    VALUES (${name}, ${holder}, now() + make_interval(secs => ${seconds}::double precision), now())
    ON CONFLICT ("name") DO UPDATE
      SET "holder" = EXCLUDED."holder", "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = now()
      WHERE "Lease"."holder" = EXCLUDED."holder" OR "Lease"."expiresAt" < now()
    RETURNING "holder"`;
  return rows.length > 0 && rows[0].holder === holder;
}

export async function releaseLease(name: string, holder = INSTANCE_ID) {
  await prisma.lease.deleteMany({ where: { name, holder } });
}

export async function currentLease(name: string) {
  return prisma.lease.findUnique({ where: { name } });
}

/** First caller with this key gets true; every later caller (any instance) gets false. */
/** True for exactly one caller per key. Insert-or-skip, so an expected duplicate never logs prisma:error. */
export async function claimOnce(key: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "SentKey" ("key", "createdAt") VALUES (${key.slice(0, 190)}, ${new Date()})
    ON CONFLICT ("key") DO NOTHING
    RETURNING "key"`;
  return rows.length > 0;
}

export async function pruneSentKeys(days = 30) {
  await prisma.sentKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - days * 86400000) } } });
}