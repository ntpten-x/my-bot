import { prisma } from "./prisma";
import type { GuardStore } from "./login-guard";

export const dbGuardStore: GuardStore = {
  async get(key) {
    const row = await prisma.loginGuard.findUnique({ where: { key } });
    return row ? { failures: row.failures, windowStart: row.windowStart, lockedUntil: row.lockedUntil } : null;
  },
  async set(key, state) {
    await prisma.loginGuard.upsert({ where: { key }, create: { key, ...state }, update: state });
  },
  async clear(key) {
    await prisma.loginGuard.deleteMany({ where: { key } });
  },
};