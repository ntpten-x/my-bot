import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const fixture = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const os = process.getBuiltinModule("node:os");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mybot-reply-queue-"));
  process.env.DATABASE_URL = `file:${path.join(directory, "fixture.db").replaceAll("\\", "/")}`;
  process.env.MYBOT_PROCESS = "worker";
  return { directory, notify: [] as unknown[][] };
});
vi.mock("../../src/lib/log", () => ({ workerLog: vi.fn(async () => undefined) }));
vi.mock("../../src/lib/notify", () => ({ dispatchNotification: vi.fn(async (...args: unknown[]) => void fixture.notify.push(args)) }));

import { prisma } from "../../src/lib/prisma";
import { upsertSettings } from "../../src/lib/settings";
import { ReplyQueueError, buildReplyQueue, finishReplyItem, openReplyItem, replyQueueState } from "../../src/lib/reply-queue";

let seq = 0;
async function post(sourceId: string, authorName: string, extra: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.post.create({
    data: {
      sourceId,
      externalUrl: `https://www.facebook.com/groups/1/posts/${seq}`,
      authorName,
      text: `ต้องการช่างแอร์ ${seq}`,
      normalizedText: `ต้องการช่างแอร์ ${seq}`,
      contentHash: `hash-${seq}`,
      intent: "buyer",
      score: 80,
      ...extra,
    },
  });
}

beforeAll(() => {
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { env: { ...process.env }, stdio: "pipe" });
}, 30_000);

beforeEach(async () => {
  fixture.notify.length = 0;
  await prisma.replyQueueItem.deleteMany();
  await prisma.post.deleteMany();
  await prisma.source.deleteMany();
  await prisma.replyTemplate.deleteMany();
  await prisma.setting.deleteMany({ where: { key: { startsWith: "reply_" } } });
  await upsertSettings({ reply_daily_cap: "20", reply_group_daily_cap: "2", reply_author_days: "7", reply_min_score: "60", reply_gap_min_minutes: "2", reply_gap_max_minutes: "5" });
});

describe("reply queue against SQLite", () => {
  it("builds a deduped queue with rotated drafts, gates opening, and logs replied", async () => {
    const g1 = await prisma.source.create({ data: { type: "facebook_group", name: "กลุ่มแอร์", url: "https://www.facebook.com/groups/1" } });
    const g2 = await prisma.source.create({ data: { type: "facebook_group", name: "กลุ่มบ้าน", url: "https://www.facebook.com/groups/2" } });
    await prisma.replyTemplate.createMany({ data: [{ name: "A", body: "สวัสดีคุณ {author} รับงานครับ" }, { name: "B", body: "ทักแชทได้เลยครับ {author}" }] });
    // Equal scores: newest first, so group 1 fills its cap (2) with มานี and สมหญิง.
    await post(g1.id, "สมชาย");
    await post(g1.id, "สมชาย ");
    await post(g1.id, "สมหญิง");
    await post(g1.id, "มานี");
    await post(g2.id, "ปิติ", { score: 10 }); // below min score
    await post(g2.id, "ชูใจ", { isAd: true });
    await post(g2.id, "วีระ");
    await post(g2.id, "อดีตลูกค้า"); // author replied to within the window
    await post(g2.id, "อดีตลูกค้า", { pipelineStatus: "replied", repliedAt: new Date() });

    const built = await buildReplyQueue({ notify: true });
    expect(built.created).toBe(3);
    expect(fixture.notify).toHaveLength(1);
    const items = await prisma.replyQueueItem.findMany({ include: { post: true } });
    expect(new Set(items.map((item) => item.post.authorName))).toEqual(new Set(["มานี", "สมหญิง", "วีระ"]));
    expect(new Set(items.map((item) => item.templateId)).size).toBe(2);
    expect(items.every((item) => item.text.includes(item.post.authorName))).toBe(true);

    expect(items.filter((item) => item.sourceId === g1.id)).toHaveLength(2);

    // Group 1 is capped for today and สมชาย is the only new author left there.
    expect((await buildReplyQueue({ notify: false })).created).toBe(0);
    await upsertSettings({ reply_group_daily_cap: "5" });
    expect((await buildReplyQueue({ notify: false })).created).toBe(1); // one สมชาย only, never twice
    expect(await prisma.replyQueueItem.count()).toBe(4);

    const [first, second] = (await replyQueueState()).items;
    const opened = await openReplyItem(first.id);
    expect(opened.url).toMatch(/^https:\/\/www\.facebook\.com\//);
    await expect(openReplyItem(second.id)).rejects.toMatchObject({ status: 429 });
    const err = await openReplyItem(second.id).catch((error) => error as ReplyQueueError);
    expect(err.waitMs).toBeGreaterThanOrEqual(110_000);
    expect(err.waitMs).toBeLessThanOrEqual(300_000);

    await finishReplyItem(first.id, "sent");
    const post1 = await prisma.post.findUniqueOrThrow({ where: { id: first.postId } });
    expect(post1.pipelineStatus).toBe("replied");
    expect(post1.repliedAt).toBeTruthy();
    expect(post1.followUpAt).toBeTruthy();
    const state = await replyQueueState();
    expect(state.openedToday).toBe(1);
    expect(state.nextAllowedAt).toBeTruthy();
    expect(state.items.find((item) => item.id === first.id)?.status).toBe("sent");

    await finishReplyItem(second.id, "skip");
    expect((await prisma.replyQueueItem.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("skipped");
  });

  it("respects the daily cap", async () => {
    await upsertSettings({ reply_daily_cap: "1", reply_gap_min_minutes: "0", reply_gap_max_minutes: "0" });
    const g = await prisma.source.create({ data: { type: "facebook_group", name: "g", url: "https://www.facebook.com/groups/9" } });
    await post(g.id, "a", { suggestedReply: "สนใจครับ" });
    await post(g.id, "b", { suggestedReply: "สนใจครับ" });
    expect((await buildReplyQueue()).created).toBe(1);
    expect(await buildReplyQueue()).toMatchObject({ created: 0 });
  });
});
