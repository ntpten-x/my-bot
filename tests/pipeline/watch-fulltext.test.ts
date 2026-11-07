import { describe, expect, it } from "vitest";
import { planWatchAlerts, type WatchCondition, type WatchState } from "../../src/lib/watchdog";
import { rankRefetch, summarizeReaderRuns } from "../../src/lib/scrape-runs";

const H = 3600_000;
const bad: WatchCondition = { key: "extension", label: "ส่วนขยาย Chrome", level: "bad", message: "ออฟไลน์", hint: "" };
const ok: WatchCondition = { ...bad, level: "ok", message: "ออนไลน์" };
const st = (level: "ok" | "bad", since: string): WatchState => ({ extension: { level, label: "", message: "", hint: "", since, lastOkAt: null } });

describe("watchdog alert plan", () => {
  const since = new Date(0).toISOString();
  it("waits one run, then alerts once per window, then sends one recovered", () => {
    expect(planWatchAlerts({}, st("bad", since), [bad], {}, 5 * 60_000, 6 * H).send).toHaveLength(0);
    const first = planWatchAlerts(st("bad", since), st("bad", since), [bad], {}, 10 * 60_000, 6 * H);
    expect(first.send.map((s) => s.kind)).toEqual(["alert"]);
    const again = planWatchAlerts(st("bad", since), st("bad", since), [bad], first.alerted, 2 * H, 6 * H);
    expect(again.send).toHaveLength(0);
    const later = planWatchAlerts(st("bad", since), st("bad", since), [bad], first.alerted, 7 * H, 6 * H);
    expect(later.send).toHaveLength(1);
    expect(later.send[0].claimKey).not.toBe(first.send[0].claimKey);
    const back = planWatchAlerts(st("bad", since), st("ok", since), [ok], later.alerted, 8 * H, 6 * H);
    expect(back.send.map((s) => s.kind)).toEqual(["recovered"]);
    expect(back.alerted).toEqual({});
    expect(planWatchAlerts(st("ok", since), st("ok", since), [ok], back.alerted, 9 * H, 6 * H).send).toHaveLength(0);
  });
  it("no recovered message when nothing was alerted", () => {
    expect(planWatchAlerts(st("bad", since), st("ok", since), [ok], {}, H, 6 * H).send).toHaveLength(0);
  });
});

describe("full-text refetch ranking", () => {
  it("prefers newest and high score, caps at 10", () => {
    const now = new Date(100 * H);
    const rows = Array.from({ length: 15 }, (_, i) => ({ id: String(i), externalUrl: `u${i}`, score: i === 0 ? 90 : 0, createdAt: new Date(now.getTime() - (i + 1) * 4 * H), refetchAttempts: 0 }));
    const picked = rankRefetch(rows, now);
    expect(picked).toHaveLength(10);
    expect(picked[0].id).toBe("0");
    expect(picked[1].id).toBe("1");
  });
});

describe("reader stats", () => {
  it("counts stalls in the background reader window", () => {
    const r = summarizeReaderRuns([
      { windowState: "offscreen", stalls: 2, reloaded: true, throttled: false, fullTried: 3, fullOk: 2, durationMs: 4000 },
      { windowState: "minimized", stalls: 0, reloaded: false, throttled: false, fullTried: 0, fullOk: 0, durationMs: 2000 },
    ]);
    expect(r).toMatchObject({ total: 2, minimized: 2, stalledMinimized: 1, reloaded: 1, fullTried: 3, fullOk: 2, avgSeconds: 3 });
  });
});
