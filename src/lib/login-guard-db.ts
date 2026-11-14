import { prisma } from "./prisma";
import type { GuardStore } from "./login-guard";
import type { Prisma } from "@prisma/client";

function guardStore(db: Pick<Prisma.TransactionClient, "loginGuard">): GuardStore { return {
  async get(key) {
    const row = await db.loginGuard.findUnique({ where: { key } });
    return row ? { failures: row.failures, windowStart: row.windowStart, lockedUntil: row.lockedUntil } : null;
  },
  async set(key, state) {
    await db.loginGuard.upsert({ where: { key }, create: { key, ...state }, update: state });
  },
  async clear(key) {
    await db.loginGuard.deleteMany({ where: { key } });
  },
}; }

export const dbGuardStore: GuardStore = {
  ...guardStore(prisma),
  atomic: work => prisma.$transaction(async tx => {
    // One short transaction per attempt prevents lost increments across web hosts.
    // The lock is released before password hashing, UI work or external requests.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71024, 2)`;
    await work(guardStore(tx));
  }),
};
