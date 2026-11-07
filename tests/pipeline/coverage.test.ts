import { describe, expect, it } from "vitest";
import { assessCoverage, type CoverageRun } from "@/lib/coverage";

const NOW = new Date("2026-11-05T12:00:00+07:00");
const run = (minutesAgo: number, extra: Partial<CoverageRun> = {}): CoverageRun => ({
  createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  mode: "normal",
  ok: true,
  found: 12,
  fresh: 2,
  inserted: 2,
  stoppedBy: "seen",
  reachedKnown: true,
  hitLimit: false,
  stalls: 0,
  ...extra,
});
const base = { intervalMinutes: 15, autoFetchOn: true, hasStoredPosts: true, now: NOW };

describe("coverage indicator", () => {
  it("is ok when recent runs reach known posts", () => {
    const c = assessCoverage({ ...base, runs: [run(5), run(20), run(35)], lastRunAt: new Date(NOW.getTime() - 5 * 60_000) });
    expect(c.level).toBe("ok");
    expect(c.reachedKnownPct).toBe(100);
  });

  it("flags auto-fetch off and long gaps as likely missing", () => {
    expect(assessCoverage({ ...base, autoFetchOn: false, runs: [run(5)], lastRunAt: new Date(NOW.getTime() - 5 * 60_000) }).level).toBe("bad");
    const gap = assessCoverage({ ...base, runs: [], lastRunAt: new Date(NOW.getTime() - 29 * 3600_000) });
    expect(gap.level).toBe("bad");
    expect(gap.reasons[0]).toContain("29 ชม.");
  });

  it("warns when runs hit the limit before known posts or see only one post", () => {
    const limited = assessCoverage({ ...base, runs: [run(5, { hitLimit: true, reachedKnown: false, stoppedBy: "limit" })], lastRunAt: NOW });
    expect(limited.level).toBe("warn");
    const thin = [run(5, { found: 1, stoppedBy: "end", reachedKnown: false }), run(20, { found: 1, stoppedBy: "end", reachedKnown: false })];
    expect(assessCoverage({ ...base, runs: thin, lastRunAt: NOW }).reasons.join()).toContain("≤1 โพสต์");
  });

  it("uses the latest audit's missed-post count", () => {
    const c = assessCoverage({ ...base, runs: [run(5), run(90, { mode: "audit", inserted: 4, reachedKnown: false })], lastRunAt: NOW });
    expect(c).toMatchObject({ level: "bad", missedInAudit: 4 });
  });

  it("accepts completed deep scans without known streaks and never calls a cap complete", () => {
    const complete=[run(5,{mode:"catchup",stoppedBy:"exhausted",reachedKnown:false}),run(20,{mode:"sweep",stoppedBy:"old",reachedKnown:false}),run(35,{mode:"catchup",stoppedBy:"exhausted",reachedKnown:false})];
    expect(assessCoverage({...base,runs:complete,lastRunAt:NOW}).level).toBe("ok");
    expect(assessCoverage({...base,runs:[run(5,{stoppedBy:"cap",hitLimit:false})],lastRunAt:NOW}).level).toBe("warn");
  });
});
