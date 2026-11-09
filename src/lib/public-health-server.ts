import { prisma } from "@/lib/prisma";
import { APP_VERSION } from "@/lib/version";
import { buildHealth, createHealthCache, httpStatusFor } from "@/lib/public-health";
import { schemaReadiness } from "./schema-readiness";
import { publicBuildHeaders } from "./build-info";

const startedAt = Date.now();
const cache = createHealthCache(7000);


async function extensionLastSeen() {
  const row = await prisma.extensionHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } });
  return row?.lastSeenAt ?? null;
}

export async function healthResponse(head = false) {
  const report = await cache(() =>
    buildHealth({
      pingDb: async () => { if (!(await schemaReadiness()).ready) throw new Error("Database schema is not ready"); },
      workerReady: async () => {
        const [lease, progress, posts] = await Promise.all([prisma.lease.findUnique({ where: { name: "worker" } }), prisma.setting.findUnique({ where: { key: "worker_consumer_progress" } }), prisma.setting.findUnique({ where: { key: "worker_post_progress" } })]);
        return Boolean(lease && lease.expiresAt.getTime() > Date.now() && progress && Date.parse(progress.value) > Date.now() - 180_000 && posts && Date.parse(posts.value) > Date.now() - 180_000);
      },
      extensionLastSeen,
      version: APP_VERSION,
      startedAt,
    }),
  );
  const headers = { "content-type": "application/json; charset=utf-8", ...publicBuildHeaders() };
  return new Response(head ? null : JSON.stringify(report), { status: httpStatusFor(report), headers });
}
