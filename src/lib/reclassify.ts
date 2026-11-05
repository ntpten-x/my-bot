import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getSettings, upsertSettings } from "./settings";
import { enqueueAiJobs } from "./ai/queue";
import { workerLog } from "./log";

const DAY = 24 * 3600_000;
export const RECLASS_BATCH = 20;
export const RECLASS_EVERY_MS = 30 * 60_000;
/** A post is re-sent at most once a week (the job's createdAt is reset on every re-send). */
export const RECLASS_COOLDOWN_MS = 7 * DAY;

/** Recent originals the rules decided, or that ended up "other"/no category; never owner-fixed or plain ads. */
export function reclassWhere(now: number, otherId: string | null): Prisma.PostWhereInput {
  return {
    duplicateOfId: null,
    dismissed: false,
    createdAt: { gte: new Date(now - 30 * DAY) },
    NOT: [{ aiProvider: "owner" }, { aiProvider: "rules:ad" }],
    AND: [
      {
        OR: [
          { aiProvider: null },
          { aiProvider: { startsWith: "rules" } },
          { categoryId: null },
          ...(otherId ? [{ categoryId: otherId }] : []),
          // Game/IT posts where neither rules nor the group could name the game/product.
          { productBy: "none", category: { slug: { in: ["games", "it"] } } },
        ],
      },
      { OR: [{ aiJobs: { none: {} } }, { aiJobs: { every: { status: { in: ["done", "failed", "skipped"] }, createdAt: { lt: new Date(now - RECLASS_COOLDOWN_MS) } } } }] },
    ],
  };
}

/** Bounded re-run of weak labels through the AI queue. Skips while providers cool down (jobs waiting on backoff). */
export async function maybeReclassify(now = Date.now()) {
  const settings = await getSettings();
  if (settings.aiProvider === "rules") return 0;
  const last = await prisma.setting.findUnique({ where: { key: "reclass_last_at" } });
  if (last && now - Date.parse(last.value) < RECLASS_EVERY_MS) return 0;
  await upsertSettings({ reclass_last_at: new Date(now).toISOString() });
  const [busy, cooling] = await Promise.all([
    prisma.aiJob.count({ where: { status: { in: ["pending", "running"] } } }),
    prisma.aiJob.count({ where: { status: "pending", lastError: { not: "" }, nextAttemptAt: { gt: new Date(now) } } }),
  ]);
  if (busy >= RECLASS_BATCH || cooling > 0) return 0;
  const other = await prisma.category.findFirst({ where: { slug: "other", parentId: null }, select: { id: true } });
  const posts = await prisma.post.findMany({ where: reclassWhere(now, other?.id ?? null), select: { id: true }, orderBy: { createdAt: "desc" }, take: RECLASS_BATCH });
  if (!posts.length) return 0;
  await enqueueAiJobs(posts.map((post) => post.id), true);
  await workerLog({ message: `ส่งโพสต์ที่จัดหมวดด้วยกฎ/อื่นๆ ให้ AI จัดใหม่ ${posts.length} โพสต์` });
  return posts.length;
}
