import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assessWatch, mergeWatchState, parseWatchState, type WatchFacts } from "../../src/lib/watchdog";
import { tuneDatabaseUrl, prisma } from "../../src/lib/prisma";
import { acquireLease, claimOnce, releaseLease } from "../../src/lib/lease";

const fixture = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module");
  const helper = createRequire(`${process.cwd()}/package.json`)("./tests/helpers/pg-test-db.cjs");
  return { ...helper.setupTestDatabase("test_stability"), drop: helper.dropTestSchema };
});

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const thresholds = { watchNoPostsHours: 6, watchExtOfflineMinutes: 30, watchParseSpikePct: 30 };
const healthy: WatchFacts = {
  now: NOW,
  enabledExtensionSources: 3,
  lastHeartbeatAt: NOW - 60_000,
  extensionEnabled: true,
  extensionErrors24h: 0,
  extensionOutbox: 0,
  lastExtensionPostAt: NOW - 30 * 60_000,
  parseRecent: { total: 40, noAuthor: 2, noText: 1 },
  parseBaseline: { total: 400, noAuthor: 20, noText: 8 },
  aiMode: "auto",
  aiProvidersEnabled: 2,
  aiProvidersReady: 1,
  oldestPendingAiJobAt: NOW - 60_000,
  workerLastTickAt: NOW - 60_000,
  dbTransientErrors: 0,
  dbError: null,
};
const level = (facts: Partial<WatchFacts>, key: string) => assessWatch({ ...healthy, ...facts }, thresholds).find((c) => c.key === key)?.level;

describe("watchdog assessment", () => {
  it("is all green for a healthy system", () => {
    expect(assessWatch(healthy, thresholds).every((c) => c.level === "ok")).toBe(true);
  });
  it("flags an offline extension and auto-fetch off", () => {
    expect(level({ lastHeartbeatAt: NOW - 31 * 60_000 }, "extension")).toBe("bad");
    expect(level({ extensionEnabled: false }, "extension")).toBe("off");
    expect(level({ extensionOutbox: 3 }, "extension")).toBe("warn");
  });
  it('alerts on verified login loss, old pending delivery and overdue sources, respecting owner pauses', () => {
    const collection = { fbLoggedIn: true, quietReason: '', pendingPosts: 3, oldestPendingAt: NOW - 16 * 60_000, overdueSources: 0 };
    expect(level({ collection }, 'collection')).toBe('bad');
    expect(level({ collection: { ...collection, oldestPendingAt: NOW - 60_000 } }, 'collection')).toBe('ok');
    expect(level({ collection: { ...collection, pendingPosts: 0, overdueSources: 2 } }, 'collection')).toBe('bad');
    expect(level({ collection: { ...collection, quietReason: 'ช่วงพักที่เจ้าของตั้งไว้' } }, 'collection')).toBe('off');
    expect(level({ collection: { ...collection, fbLoggedIn: false } }, 'facebook')).toBe('bad');
    expect(level({ collection: { ...collection, fbLoggedIn: null } }, 'facebook')).toBeUndefined();
    expect(level({ collection, extensionEnabled: false }, 'collection')).toBeUndefined();
    expect(level({ collection, lastHeartbeatAt: NOW - 3600_000 }, 'collection')).toBeUndefined();
  });
  it("flags no posts only while the extension is online", () => {
    expect(level({ lastExtensionPostAt: NOW - 7 * 3600_000 }, "posts")).toBe("bad");
    expect(level({ lastExtensionPostAt: NOW - 7 * 3600_000, lastHeartbeatAt: NOW - 3600_000 }, "posts")).toBe("ok");
  });
  it("flags a parse-quality spike against the baseline", () => {
    expect(level({ parseRecent: { total: 40, noAuthor: 30, noText: 1 } }, "parse")).toBe("bad");
    expect(level({ parseRecent: { total: 5, noAuthor: 5, noText: 5 } }, "parse")).toBe("ok");
  });
  it("keeps local rules available without model providers and monitors the worker and DB", () => {
    expect(level({ aiProvidersReady: 0 }, "bot")).toBe("ok");
    expect(level({ aiMode: "rules", aiProvidersReady: 0 }, "bot")).toBe("ok");
    expect(level({ workerLastTickAt: NOW - 11 * 60_000 }, "worker")).toBe("bad");
    expect(level({ dbError: "timeout" }, "db")).toBe("bad");
    expect(level({ dbTransientErrors: 6 }, "db")).toBe("warn");
  });
  it("keeps since/lastOkAt across runs", () => {
    const first = mergeWatchState({}, assessWatch(healthy, thresholds), NOW);
    const second = mergeWatchState(first, assessWatch({ ...healthy, now: NOW + 300_000, workerLastTickAt: NOW - 11 * 60_000 }, thresholds), NOW + 300_000);
    expect(second.worker.level).toBe("bad");
    expect(second.worker.lastOkAt).toBe(new Date(NOW).toISOString());
    expect(second.worker.since).toBe(new Date(NOW + 300_000).toISOString());
    expect(second.db.since).toBe(new Date(NOW).toISOString());
    expect(parseWatchState("not json")).toEqual({});
  });
});

describe("database url tuning", () => {
  it("adds pool params for the pgbouncer pooler and keeps explicit ones", () => {
    const tuned = new URL(tuneDatabaseUrl("postgresql://u:p@db.example.com:6543/postgres", {})!);
    expect(tuned.searchParams.get("pgbouncer")).toBe("true");
    expect(tuned.searchParams.get("connection_limit")).toBe("8");
    expect(tuned.searchParams.get("pool_timeout")).toBe("20");
    const kept = new URL(tuneDatabaseUrl("postgresql://u:p@db.example.com:5432/postgres?connection_limit=3", {})!);
    expect(kept.searchParams.get("connection_limit")).toBe("3");
    expect(kept.searchParams.has("pgbouncer")).toBe(false);
    expect(tuneDatabaseUrl(undefined)).toBeUndefined();
  });
});

describe.skipIf(!fixture.enabled)("leader lease and idempotency keys (database)", () => {
  const name = `test-lease-${process.pid}-${Date.now()}`;
  const key = `test-key-${process.pid}-${Date.now()}`;
  beforeAll(() => {
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: process.env, stdio: "pipe" });
  }, 180_000);
  afterAll(async () => {
    await fixture.drop(prisma, fixture.schema);
    await prisma.$disconnect();
  });
  it("lets one holder lead until it releases or expires", async () => {
    expect(await acquireLease(name, 60_000, "a")).toBe(true);
    expect(await acquireLease(name, 60_000, "b")).toBe(false);
    expect(await acquireLease(name, 60_000, "a")).toBe(true);
    await releaseLease(name, "a");
    expect(await acquireLease(name, 1_000, "b")).toBe(true);
    await prisma.lease.update({ where: { name }, data: { expiresAt: new Date(Date.now() - 5_000) } });
    expect(await acquireLease(name, 60_000, "a")).toBe(true);
  });
  it("claims a key exactly once even when raced", async () => {
    const results = await Promise.all([claimOnce(key), claimOnce(key), claimOnce(key)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
