/** Reproduce audit findings using synthetic rows on an explicitly local test DB only. */
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

async function main() {
  const input = process.env.TEST_DATABASE_URL;
  if (!input) throw new Error("TEST_DATABASE_URL is required; never falls back to DATABASE_URL");
  const url = new URL(input);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("This audit accepts a local disposable PostgreSQL instance only");
  }
  const schema = `test_system_audit_${randomBytes(6).toString("hex")}`;
  url.searchParams.set("schema", schema);
  process.env.DATABASE_URL = process.env.DIRECT_URL = url.toString();
  process.env.MYBOT_PROCESS = "worker";
  process.env.AI_KEY_SECRET = "synthetic-system-audit-not-production";
  execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], { stdio: "pipe", env: process.env });
  const { prisma } = await import("../src/lib/prisma");
  try {
    const source = await prisma.source.create({ data: { name: "synthetic audit", type: "facebook_group", url: "https://www.facebook.com/groups/12345" } });
    const post = await prisma.post.create({ data: { sourceId: source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/123456", text: "หารองเท้าวิ่ง", normalizedText: "หารองเท้าวิ่ง", contentHash: "synthetic-audit" } });
    const aiJob = await prisma.aiJob.create({ data: { postId: post.id, nextAttemptAt: new Date(Date.now() + 3600_000) } });
    const timeResults = [];
    for (const zone of ["UTC", "Asia/Bangkok"]) {
      timeResults.push(await prisma.$transaction(async tx => {
        if (zone === "UTC") await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
        else await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Bangkok'`;
        const raw = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "AiJob" WHERE "id"=${aiJob.id} AND "nextAttemptAt"<=${new Date()}`;
        const orm = await tx.aiJob.count({ where: { id: aiJob.id, nextAttemptAt: { lte: new Date() } } });
        const lease = await tx.$queryRaw<{ expiresAt: Date }[]>`INSERT INTO "Lease" ("name","holder","expiresAt","updatedAt") VALUES (${zone},'synthetic',now()+interval '150 seconds',now()) RETURNING "expiresAt"`;
        return { zone, futureAiJobSelectedByRaw: raw.length, futureAiJobSelectedByOrm: orm, leaseClockSkewSeconds: Math.round((lease[0].expiresAt.getTime() - Date.now()) / 1000 - 150) };
      }));
    }
    const crossTimezoneLiveLeaseStolen = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      await tx.$executeRaw`INSERT INTO "Lease" ("name","holder","expiresAt","updatedAt") VALUES ('synthetic-cross-zone','first',now()+interval '150 seconds',now())`;
      await tx.$executeRaw`SET LOCAL TIME ZONE 'Asia/Bangkok'`;
      const stolen = await tx.$queryRaw<{ holder: string }[]>`
        INSERT INTO "Lease" ("name","holder","expiresAt","updatedAt")
        VALUES ('synthetic-cross-zone','second',now()+interval '150 seconds',now())
        ON CONFLICT ("name") DO UPDATE SET "holder"=EXCLUDED."holder", "expiresAt"=EXCLUDED."expiresAt"
        WHERE "Lease"."holder"=EXCLUDED."holder" OR "Lease"."expiresAt"<now()
        RETURNING "holder"`;
      return stolen.some(row => row.holder === "second");
    });
    const { autoCommentRuleSchema } = await import("../src/lib/auto-comment/schema");
    const { saveCommentRule } = await import("../src/lib/auto-comment/admin");
    const { updateCommentControl } = await import("../src/lib/auto-comment/control");
    const { scanBrowserComments, prepareBrowserComments, claimBrowserComment } = await import("../src/lib/auto-comment/browser");
    const device = await prisma.extensionDevice.create({ data: { name: "synthetic", tokenHash: "synthetic", tokenHint: "test" } });
    await saveCommentRule(autoCommentRuleSchema.parse({ name: "synthetic audit", enabled: true, sourceIds: [source.id], keywords: "รองเท้า", templates: ["synthetic text, never sent"], deliveryMode: "extension", browserConsent: true, browserDeviceId: device.id, browserFbUserId: "12345678" }));
    await updateCommentControl({ dryRun: false, liveAcknowledged: true });
    await updateCommentControl({ action: "start" });
    // Only synthetic post, created after Start. No browser, authorization or network send.
    const fresh = await prisma.post.create({ data: { sourceId: source.id, externalUrl: "https://www.facebook.com/groups/12345/posts/123457", text: "หารองเท้าวิ่ง", normalizedText: "หารองเท้าวิ่ง", contentHash: "synthetic-fresh" } });
    const active = async () => undefined;
    await scanBrowserComments(active); await prepareBrowserComments(active);
    await prisma.post.update({ where: { id: fresh.id }, data: { text: "หารองเท้าวิ่ง งบ 1000", textRevision: { increment: 1 } } });
    await scanBrowserComments(active);
    const claim = await claimBrowserComment(device.id, "12345678");
    await scanBrowserComments(active); await prepareBrowserComments(active);
    const job = await prisma.autoCommentJob.findFirstOrThrow({ where: { postId: fresh.id } });
    const checkpoint = await prisma.autoCommentEvaluation.findFirstOrThrow({ where: { postId: fresh.id } });
    const { commentIntent } = await import("../src/lib/auto-comment/intent");
    const intentExamples = ["หารองเท้า ไม่ขายครับ", "อยากได้รองเท้า แต่ไม่ซื้อของปลอม", "หารองเท้าครับ ไม่ต้องการสีแดง"]
      .map(text => ({ text, result: commentIntent({ text }) }));
    console.log(JSON.stringify({ timeResults, crossTimezoneLiveLeaseStolen, staleReadyJob: { claim: claim === null ? "rejected" : "claimed", status: job.status, textRevision: job.textRevision, checkpointState: checkpoint.state, scheduledReevaluation: Boolean(checkpoint.nextEvaluateAt) }, intentExamples }, null, 2));
  } finally {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  }
}

main().catch(() => { console.error("Audit failed (details hidden). Check the local test DB and migrations."); process.exitCode = 1; });
