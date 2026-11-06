import { beforeEach, describe, expect, it, vi } from "vitest";
import { explainCommentRule, matchesCommentRule, type MatchPost, type MatchRule } from "../../src/lib/auto-comment/matching";

const mocks = vi.hoisted(() => ({ authed: vi.fn(), findUnique: vi.fn() }));
vi.mock("../../src/lib/guard", () => ({ authed: mocks.authed }));
vi.mock("../../src/lib/prisma", () => ({ prisma: { autoCommentRule: { findUnique: mocks.findUnique } } }));
import { POST } from "../../src/app/api/auto-comment/preview/route";

const now = new Date("2026-11-02T03:00:00Z"); // Monday 10:00 Bangkok
const rule: MatchRule = { enabled: true, pausedReason: "", sourceIdsJson: '["group"]', keywords: "หาช่าง,แอร์", excludeKeywords: "รับงาน", keywordMode: "all", startMinute: 0, endMinute: 1440, daysJson: "[0,1,2,3,4,5,6]", maxAgeHours: 24 };
const post: MatchPost = { text: "หาช่างแอร์", sourceId: "group", createdAt: now, postedAt: null, isAd: false, forbiddenHit: false, duplicateOfId: null, dismissed: false };
const request = (data: unknown, headers = {}) => new Request("http://localhost:8001/api/auto-comment/preview", { method: "POST", headers: { origin: "http://localhost:8001", "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
const input = { ruleId: "rule", sourceId: "group", text: "หาช่างแอร์" };
beforeEach(() => { vi.clearAllMocks(); mocks.authed.mockResolvedValue({ error: null }); mocks.findUnique.mockResolvedValue(rule); });

describe("shared rule explanations", () => {
  it("reports every failure without hiding keyword and exclusion evidence", () => {
    const result = explainCommentRule({ ...rule, enabled: false }, { ...post, text: "รับงานแอร์", isAd: true, sourceId: "other" }, now);
    expect(result.matched).toBe(false);
    expect(result.checks.filter(check => !check.passed).map(check => check.code)).toEqual(["enabled", "not_ad", "source", "excluded", "keywords"]);
    expect(result.matchedKeywords).toEqual(["แอร์"]); expect(result.excludedKeywords).toEqual(["รับงาน"]);
  });
  it.each([
    { dismissed: true }, { forbiddenHit: true }, { duplicateOfId: "duplicate" },
    { postedAt: new Date(now.getTime() - 25 * 3600_000) },
    { postedAt: new Date(now.getTime() + 2 * 3600_000) },
  ])("rejects excluded post state %j in worker and preview", change => {
    expect(explainCommentRule(rule, { ...post, ...change }, now).matched).toBe(false);
    expect(matchesCommentRule(rule, { ...post, ...change }, now)).toBe(false);
  });
  it("retains any/all, no-keyword and overnight Bangkok behavior", () => {
    expect(matchesCommentRule(rule, post, now)).toBe(true);
    expect(matchesCommentRule({ ...rule, keywordMode: "any" }, { ...post, text: "แอร์" }, now)).toBe(true);
    expect(matchesCommentRule({ ...rule, keywords: "" }, { ...post, text: "อื่น ๆ" }, now)).toBe(true);
    const overnight = { ...rule, startMinute: 1320, endMinute: 120, daysJson: "[1]" };
    expect(explainCommentRule(overnight, post, new Date("2026-11-02T18:00:00Z")).matched).toBe(true);
    expect(explainCommentRule(overnight, post, new Date("2026-11-02T19:00:00Z")).checks.find(check => check.code === "window")?.passed).toBe(false);
  });
});

describe("read-only preview API integration with mocked storage", () => {
  it("requires authentication and same-origin JSON before reading rules", async () => {
    mocks.authed.mockResolvedValueOnce({ error: new Response(null, { status: 401 }) });
    expect((await POST(request(input))).status).toBe(401);
    expect((await POST(request(input, { origin: "https://other.test" }))).status).toBe(403);
    expect((await POST(request(input, { "content-type": "text/plain" }))).status).toBe(415);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it.each([{ ...input, text: "x".repeat(20001) }, { ...input, postedAt: "bad" }, { ...input, pageToken: "SYNTHETIC_SECRET" }, { ...input, text: " " }])("rejects invalid or credential-bearing input", async body => {
    const response = await POST(request(body)); expect(response.status).toBe(400);
    expect(mocks.findUnique).not.toHaveBeenCalled(); expect(await response.text()).not.toContain("SYNTHETIC_SECRET");
  });
  it("selects no credentials, returns no dispatch permission and never calls providers", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No external calls allowed"));
    try {
      const response = await POST(request(input)); const result = await response.json();
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
      expect(result.matched).toBe(true); expect(result.dispatchAuthorized).toBe(false);
      expect(mocks.findUnique).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(mocks.findUnique.mock.calls)).not.toMatch(/Token|templates|nextTemplate/);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { fetcher.mockRestore(); }
  });
  it("handles deleted rules and redacts storage errors", async () => {
    mocks.findUnique.mockResolvedValueOnce(null); expect((await POST(request(input))).status).toBe(404);
    mocks.findUnique.mockRejectedValueOnce(new Error("SYNTHETIC_SECRET"));
    const response = await POST(request(input)); expect(response.status).toBe(500); expect(await response.text()).not.toContain("SYNTHETIC_SECRET");
  });
});
