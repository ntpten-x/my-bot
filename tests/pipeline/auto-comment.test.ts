import { describe, it, expect, vi } from "vitest";
import { commentTarget, inCommentWindow, matchesCommentRule, templateIndex } from "../../src/lib/auto-comment/matching";
import { defaultControl, mayRun, parseControl } from "../../src/lib/auto-comment/control";
import { facebookGateway, retryAfter } from "../../src/lib/auto-comment/facebook";
import { autoCommentRuleSchema } from "../../src/lib/auto-comment/schema";

const now = new Date("2026-11-09T03:00:00Z");
const rule = { enabled: true, pausedReason: "", sourceIdsJson: '["allowed"]', keywords: "ตามหา,ipad", excludeKeywords: "ขายแล้ว", keywordMode: "any", startMinute: 0, endMinute: 1440, daysJson: "[0,1,2,3,4,5,6]", maxAgeHours: 24 };
const post = { text: "ตามหา iPad มือสอง", sourceId: "allowed", createdAt: now, postedAt: null, isAd: false, forbiddenHit: false, duplicateOfId: null, dismissed: false };
const credentials = { pageId: "12345", pageToken: "synthetic-page", managerToken: "synthetic-user" };
const response = (data: unknown, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers });
function gateway(fetcher: ReturnType<typeof vi.fn>) { return facebookGateway({ appId: "999", appToken: "synthetic-app", version: "v25.0", fetcher }); }

describe("auto comment matching and fail-closed settings", () => {
  it("requires explicit source allowlist, enabled rules and safe posts", () => {
    expect(matchesCommentRule(rule, post, now)).toBe(true);
    for (const patch of [{ enabled: false }, { pausedReason: "permission" }, { sourceIdsJson: "invalid" }, { sourceIdsJson: "[]" }]) expect(matchesCommentRule({ ...rule, ...patch }, post, now)).toBe(false);
    for (const patch of [{ sourceId: "other" }, { isAd: true }, { forbiddenHit: true }, { duplicateOfId: "old" }, { dismissed: true }, { text: "ตามหา แต่ขายแล้ว" }, { postedAt: new Date("2020-01-01") }]) expect(matchesCommentRule(rule, { ...post, ...patch }, now)).toBe(false);
  });
  it("normalizes Thai/English and applies all keywords", () => {
    expect(matchesCommentRule({ ...rule, keywordMode: "all", keywords: "ตามหา,IPAD" }, post, now)).toBe(true);
    expect(matchesCommentRule({ ...rule, keywordMode: "all", keywords: "ตามหา,รถ" }, post, now)).toBe(false);
  });
  it("uses Bangkok days and carries overnight windows from their starting day", () => {
    const overnight = { startMinute: 22 * 60, endMinute: 2 * 60, daysJson: "[1]" };
    expect(inCommentWindow(overnight, new Date("2026-11-09T16:00Z"))).toBe(true);
    expect(inCommentWindow(overnight, new Date("2026-11-09T18:00Z"))).toBe(true);
    expect(inCommentWindow(overnight, new Date("2026-11-09T19:00Z"))).toBe(false);
    expect(inCommentWindow(overnight, new Date("2026-11-10T16:00Z"))).toBe(false);
  });
  it("selects sequential/random templates without out-of-range indices", () => {
    expect(templateIndex("sequential", 3, 8)).toBe(2);
    expect(templateIndex("random", 3, 8, () => 1)).toBe(1);
    expect(() => templateIndex("sequential", 0, 0)).toThrow();
  });
  it("canonicalizes supported Page URLs and rejects groups/marketplace/foreign pages", () => {
    const a = commentTarget("https://www.facebook.com/12345/posts/6789?tracking=x", "facebook_page", "12345");
    expect(a.supported).toBe(true);
    expect(commentTarget("https://m.facebook.com/story.php?id=12345&story_fbid=6789", "facebook_page", "12345").postKey).toBe(a.postKey);
    for (const url of ["https://www.facebook.com/groups/12345/posts/6789", "https://www.facebook.com/marketplace/item/6789", "https://www.facebook.com/98765/posts/6789", "https://evil.test/12345/posts/6789"]) expect(commentTarget(url, "facebook_page", "12345").supported).toBe(false);
  });
  it("defaults off/dry-run and rejects invalid settings", () => {
    expect(parseControl("garbage")).toEqual(defaultControl);
    expect(mayRun(defaultControl, now)).toBe(false);
    expect(mayRun({ ...defaultControl, state: "running", emergency: true }, now)).toBe(false);
    expect(mayRun({ ...defaultControl, state: "running", cooldownUntil: "2027-01-01" }, now)).toBe(false);
    expect(autoCommentRuleSchema.safeParse({ name: "x", templates: ["hello"] }).success).toBe(false);
  });
});

describe("official Meta gateway (mock transport only)", () => {
  it("verifies app, scopes, expiry, Page identity and manager task before proceeding", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ data: { is_valid: true, app_id: "999", type: "PAGE", scopes: ["pages_read_engagement", "pages_manage_engagement"] } }))
      .mockResolvedValueOnce(response({ data: { is_valid: true, app_id: "999", type: "USER", scopes: ["pages_show_list"] } }))
      .mockResolvedValueOnce(response({ id: "12345" }))
      .mockResolvedValueOnce(response({ data: [{ id: "12345", tasks: ["MODERATE"] }] }));
    await gateway(fetcher).verify(credentials);
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetcher.mock.calls) { expect(new URL(url).hostname).toBe("graph.facebook.com"); expect(init.redirect).toBe("error"); }
  });
  it.each([
    { is_valid: false, app_id: "999", type: "PAGE", scopes: [] },
    { is_valid: true, app_id: "wrong", type: "PAGE", scopes: ["pages_read_engagement", "pages_manage_engagement"] },
    { is_valid: true, app_id: "999", type: "PAGE", scopes: ["pages_read_engagement"] },
    { is_valid: true, app_id: "999", type: "PAGE", scopes: ["pages_read_engagement", "pages_manage_engagement"], expires_at: 1 },
  ])("rejects invalid credentials before sending", async data => {
    const fetcher = vi.fn().mockResolvedValue(response({ data }));
    await expect(gateway(fetcher).verify(credentials)).rejects.toMatchObject({ kind: "permission" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects posts that are removed, unpublished or owned by another Page", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ id: "12345_1", from: { id: "other" }, is_published: true }));
    await expect(gateway(fetcher).checkPost(credentials, "12345_1")).rejects.toMatchObject({ kind: "unavailable" });
    await expect(gateway(fetcher).checkPost(credentials, "other_1")).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("sends only via POST comments and pauses after high API usage", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ id: "12345_11" }, 200, { "x-page-usage": '{"call_count":95}' }));
    expect(await gateway(fetcher).send(credentials, "12345_1", "ข้อความทดสอบ")).toMatchObject({ id: "12345_11", pauseMs: 900000 });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://graph.facebook.com/v25.0/12345_1/comments");
    expect(init.method).toBe("POST");
    expect(init.body.get("message")).toBe("ข้อความทดสอบ");
    expect(new URL(url).searchParams.has("access_token")).toBe(false);
  });
  it.each([[429, { code: 4 }, "rate"], [403, { code: 200 }, "permission"], [404, { code: 100 }, "unavailable"], [500, {}, "uncertain"], [400, { is_transient: true }, "transient"]])("classifies error %s without leaking response bodies", async (status, error, kind) => {
    const fetcher = vi.fn().mockResolvedValue(response({ error: { ...error as object, message: "SECRET_DO_NOT_LOG" } }, status as number));
    await expect(gateway(fetcher).send(credentials, "12345_1", "test")).rejects.toMatchObject({ kind });
    await expect(gateway(fetcher).send(credentials, "12345_1", "test")).rejects.not.toThrow("SECRET_DO_NOT_LOG");
  });
  it("respects either Page/App usage header and business-use-case cooldown", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ id: "12345_11" }, 200, { "x-app-usage": '{"call_count":1}', "x-page-usage": '{"call_count":95}', "x-business-use-case-usage": '{"12345":[{"estimated_time_to_regain_access":20}]}' }));
    expect((await gateway(fetcher).send(credentials, "12345_1", "test")).pauseMs).toBe(1200000);
  });
  it.each(["wrong-page", "no-task"])("rejects manager/Page mismatch: %s", async mismatch => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response({ data: { is_valid: true, app_id: "999", type: "PAGE", scopes: ["pages_read_engagement", "pages_manage_engagement"] } }))
      .mockResolvedValueOnce(response({ data: { is_valid: true, app_id: "999", type: "USER", scopes: ["pages_show_list"] } }))
      .mockResolvedValueOnce(response({ id: mismatch === "wrong-page" ? "98765" : "12345" }))
      .mockResolvedValueOnce(response({ data: [{ id: "12345", tasks: ["ANALYZE"] }] }));
    await expect(gateway(fetcher).verify(credentials)).rejects.toMatchObject({ kind: "permission" });
  });
  it("never automatically retries an ambiguous POST/network failure", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("synthetic token should stay hidden"));
    await expect(gateway(fetcher).send(credentials, "12345_1", "test")).rejects.toMatchObject({ kind: "uncertain" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(retryAfter("120")).toBe(120000);
    expect(retryAfter(null)).toBe(900000);
  });
});
