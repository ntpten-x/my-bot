import { beforeEach, afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  type Rule = { id: string; enabled: boolean; pausedReason: string; [key: string]: unknown };
  type Job = { id: string; ruleId: string; status: string; [key: string]: unknown };
  const rules = new Map<string, Rule>();
  const jobs: Job[] = [];
  const control = { state: "running", dryRun: false, generation: "synthetic", hourlyLimit: 50, dailyLimit: 200 };
  // A tiny in-memory database implements equality, status, time and relation predicates;
  // the production claim/preparation functions still choose and mutate the rows.
  function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, expected]) => {
      if (key === "rule") return matches(rules.get(String(row.ruleId))!, expected as Record<string, unknown>);
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        const predicate = expected as { in?: unknown[]; lte?: Date; lt?: Date; gt?: Date };
        if (predicate.in) return predicate.in.includes(row[key]);
        if (predicate.lte) return row[key] instanceof Date && row[key] <= predicate.lte;
        if (predicate.lt) return row[key] instanceof Date && row[key] < predicate.lt;
        if (predicate.gt) return row[key] instanceof Date && row[key] > predicate.gt;
      }
      return row[key] === expected;
    });
  }
  const post = {
    id: "post", text: "หาช่างแอร์", textRevision: 0, intent: "buyer", processingState: "done", truncated: false,
    sourceId: "source", externalUrl: "https://www.facebook.com/groups/12345/posts/8888/", postedAt: null,
    createdAt: new Date(), isAd: false, forbiddenHit: false, duplicateOfId: null, dismissed: false,
    source: { id: "source", enabled: true, url: "https://www.facebook.com/groups/12345", type: "facebook_group", fbGroupId: null },
  };
  const db = {
    autoCommentJob: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => structuredClone(jobs.find(job => matches(job, where)) ?? null)),
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) => jobs.filter(job => matches(job, where)).slice(0, take).map(job => ({ ...job, rule: rules.get(job.ruleId) }))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(jobs.find(job => job.id === where.id)!, data)),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    autoCommentRule: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rules.get(where.id) ?? null) },
    post: { findUnique: vi.fn(async () => post) },
    extensionDevice: { findFirst: vi.fn(async () => ({ id: "device" })) },
    setting: { findUnique: vi.fn(async () => null) },
    autoCommentLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async work => work(db));
  return { rules, jobs, control, db, post };
});
vi.mock("../../src/lib/prisma", () => ({ prisma: fixture.db }));
vi.mock("../../src/lib/auto-comment/control", () => ({
  lockCommentControl: async () => fixture.control, mayRun: () => true,
}));
vi.mock("../../src/lib/auto-comment/dispatch-budget", () => ({
  globalDispatchDelay: async () => null, groupDispatchDelay: async () => null,
}));
import { claimBrowserComment, prepareBrowserComments } from "../../src/lib/auto-comment/browser";

beforeEach(() => {
  vi.stubEnv("MYBOT_PROCESS", "worker");
  fixture.jobs.length = 0; fixture.rules.clear(); vi.clearAllMocks();
  fixture.post.createdAt = new Date();
  const rule = {
    enabled: true, pausedReason: "", revision: 1, messageMode: "template", deliveryMode: "extension",
    browserConsent: true, browserDeviceId: "device", browserFbUserId: "99887766", sourceIdsJson: '["source"]',
    keywords: "หาช่าง", excludeKeywords: "", keywordMode: "any", intentMode: "keyword",
    startMinute: 0, endMinute: 1440, daysJson: "[0,1,2,3,4,5,6]", maxAgeHours: 24,
  };
  fixture.rules.set("active", { ...rule, id: "active" });
  fixture.rules.set("paused", { ...rule, id: "paused", pausedReason: "checkpoint awaiting owner review" });
  fixture.rules.set("disabled", { ...rule, id: "disabled", enabled: false });
});
afterEach(() => { vi.unstubAllEnvs(); });

function fill(status: string) {
  const data = {
    status, deliveryMode: "extension", browserDeviceId: "device", browserFbUserId: "99887766",
    generation: "synthetic", dryRun: false, nextAttemptAt: new Date(Date.now() - 1000),
    createdAt: new Date(), dispatchedAt: null, attempts: 0, claimToken: null, claimUntil: null,
    postId: "post", postKey: "group:12345:8888", ruleRevision: 1, textRevision: 0,
    externalUrl: fixture.post.externalUrl, message: "ข้อความสังเคราะห์", pageId: "group:12345",
  };
  for (let i = 0; i < 60; i++) fixture.jobs.push({ ...data, id: `parked-${i}`, ruleId: i % 2 ? "paused" : "disabled" });
  fixture.jobs.push({ ...data, id: "active-job", ruleId: "active" });
}

it("claims active work past a full page of parked jobs without releasing their pauses", async () => {
  fill("browser_ready");
  expect((await claimBrowserComment("device", "99887766"))?.id).toBe("active-job");
  expect(fixture.jobs.slice(0, 60).every(job => job.status === "browser_ready" && job.attempts === 0 && job.claimToken === null)).toBe(true);
  expect(fixture.rules.get("paused")?.pausedReason).toBe("checkpoint awaiting owner review");
});

it("prepares active work past a full page of parked jobs while retaining their state", async () => {
  fill("pending_ai");
  await prepareBrowserComments(async () => undefined);
  expect(fixture.jobs[60].status).toBe("browser_ready");
  expect(fixture.jobs.slice(0, 60).every(job => job.status === "pending_ai" && job.attempts === 0 && job.claimToken === null)).toBe(true);
});
