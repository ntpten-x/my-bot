import { readJson } from "@/lib/request-body";
import { facebookWorkAllowed } from "@/lib/facebook-accounts";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { normalizeUrl } from "@/lib/pipeline/normalize";
import { z } from "zod";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { ingestPosts } from "@/lib/ingest";
import { countCapturedPosts, noteBadExtensionToken } from "@/lib/extension-heartbeat";
import { recordTiming } from "@/lib/metrics";
import { after } from "next/server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  batchId: z.string().uuid().optional(),
  sourceUrl: z.string().url().max(2000),
  posts: z
    .array(
      z.object({
        itemId: z.string().uuid().optional(),
        url: z.string().url().max(2000),
        authorName: z.string().max(200).optional(),
        text: z.string().min(1).max(20000),
        postedAt: z.string().nullable().optional(),
        observedAt: z.number().int().nonnegative().optional(),
        images: z.array(z.string().url().max(2000)).max(6).optional(),
      }),
    )
    .max(40),
  fbUserId: z.string().regex(/^\d{5,20}$/).optional(),
});

export function OPTIONS() {
  return corsPreflight();
}

export async function POST(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization"), request))) {
    await noteBadExtensionToken();
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  if (Number(request.headers.get("content-length")) > 1_500_000) return withCors(json({ error: "ข้อมูลชุดใหญ่เกินกำหนด" }, 413));
  const parsed = bodySchema.safeParse(await readJson(request, 1_500_000).catch(() => null));
  if (!parsed.success) return withCors(json({ error: "รูปแบบข้อมูลไม่ถูกต้อง" }, 400));
  try {
    const { fbUserId, batchId, ...data } = parsed.data;
    if (!(await facebookWorkAllowed(request, fbUserId))) return withCors(json({ error: "บัญชีถูกหยุดงาน ข้อมูลยังอยู่ในคิวของส่วนขยาย", code: "ACCOUNT_PAUSED" }, 423));
    const itemIds = data.posts.map(post => post.itemId);
    if (batchId && (itemIds.some(id => !id) || new Set(itemIds).size !== itemIds.length)) return withCors(json({ error: "รายการต้องมี itemId ไม่ซ้ำ" }, 400));
    // Post and its durable rule-work marker commit before receipt acknowledgment.
    const result = await ingestPosts({ ...data, actor: "extension" }, { deferFinalize: true });
    if (result.ok && "_finalize" in result && typeof result._finalize === "function") {
      const finalize = result._finalize;
      after(async () => { await finalize().catch((error) => console.error("[ingest-finalize]", error)); });
    }
    if (result.ok) {
      const now = Date.now();
      for (const post of data.posts) {
        const latency = post.observedAt === undefined ? -1 : now - post.observedAt;
        // Browser clocks may be wrong; unknown/negative samples must not become healthy zero.
        if (latency >= 0 && latency <= 72 * 3600000) recordTiming("capture_to_ingest", latency);
      }
    }
    await countCapturedPosts(fbUserId, result.inserted).catch(() => undefined);
    const publicResult = { ...result } as Record<string, unknown>;
    delete publicResult._finalize;
    if (!batchId || !result.ok) {
      return withCors(json(publicResult, result.ok ? 200 : 404));
    }
    const deviceKey = createHash("sha256").update(request.headers.get("authorization") || "").digest("hex");
    const stored = await prisma.post.findMany({ where: { externalUrl: { in: data.posts.map(post => normalizeUrl(post.url)) } }, select: { externalUrl: true } });
    const urls = new Set(stored.map(post => post.externalUrl));
    const outcomes = (result.ok && "itemOutcomes" in result && result.itemOutcomes && typeof result.itemOutcomes === "object")
      ? result.itemOutcomes as Record<string, string>
      : {};
    const receipts = data.posts.map(post => {
      const url = normalizeUrl(post.url);
      const accepted = urls.has(url);
      const reason = outcomes[url] || (accepted ? "accepted" : "skipped");
      return { itemId: post.itemId!, outcome: accepted ? "accepted" as const : "skipped" as const, reason };
    });
    await prisma.ingestReceipt.createMany({ data: receipts.map(({ itemId, outcome }) => ({ itemId, outcome, deviceKey, batchId })), skipDuplicates: true });
    const persisted = await prisma.ingestReceipt.findMany({ where: { deviceKey, batchId }, select: { itemId: true, outcome: true } });
    const reasonByItem = new Map(receipts.map(row => [row.itemId, row.reason]));
    return withCors(json({
      ...publicResult,
      batchId,
      receipts: persisted.map(row => ({ ...row, reason: reasonByItem.get(row.itemId) || row.outcome })),
    }));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : "";
    const schemaMissing = code === "P2021" || code === "P2022";
    return withCors(json({
      error: schemaMissing ? "โครงสร้างฐานข้อมูลยังไม่พร้อม กรุณารัน migration บนเซิร์ฟเวอร์" : "บันทึกโพสต์ไม่สำเร็จ กรุณาตรวจฐานข้อมูลแล้วลองใหม่",
      code: schemaMissing ? "SCHEMA_NOT_READY" : "INGEST_FAILED",
    }, schemaMissing ? 503 : 500));
  }
}
