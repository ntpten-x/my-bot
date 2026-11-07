import { prisma } from "@/lib/prisma";
import { APP_VERSION } from "@/lib/version";
import { orderAvailable, sharedMinuteWindow } from "@/lib/ai/router";
import { ollamaReachable } from "@/lib/ai/ollama-url";
import { buildHealth, createHealthCache, httpStatusFor } from "@/lib/public-health";
import { schemaReadiness } from "./schema-readiness";

const startedAt = Date.now();
const cache = createHealthCache(7000);

async function availableAiProviders() {
  const all = await prisma.aiProvider.findMany({ where: { enabled: true } });
  const rows = all.some((row) => row.kind === "ollama") && !(await ollamaReachable()) ? all.filter((row) => row.kind !== "ollama") : all;
  const providers = rows.map((row) => ({
    ...row,
    tasks: row.tasks.split(",").map((task) => task.trim()).filter(Boolean),
  }));
  return orderAvailable(providers, "classify", new Date(), sharedMinuteWindow).ready.length;
}

async function extensionLastSeen() {
  const row = await prisma.extensionHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } });
  return row?.lastSeenAt ?? null;
}

export async function healthResponse(head = false) {
  const report = await cache(() =>
    buildHealth({
      pingDb: async () => { if (!(await schemaReadiness()).ready) throw new Error("Database schema is not ready"); },
      workerReady: async () => {
        const [lease, progress] = await Promise.all([prisma.lease.findUnique({ where: { name: "worker" } }), prisma.setting.findUnique({ where: { key: "worker_consumer_progress" } })]);
        return Boolean(lease && lease.expiresAt.getTime() > Date.now() && progress && Date.parse(progress.value) > Date.now() - 180_000);
      },
      availableAiProviders,
      extensionLastSeen,
      version: APP_VERSION,
      startedAt,
    }),
  );
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
  return new Response(head ? null : JSON.stringify(report), { status: httpStatusFor(report), headers });
}
