import { EXPECTED_EXTENSION_VERSION, extensionVersionFromRequest, isCompatibleExtensionVersion, isCurrentExtensionVersion } from "@/lib/extension-heartbeat";
import { facebookWorkAllowed } from "@/lib/facebook-accounts";
import { z } from "zod";
import { verifyDeviceToken } from "@/lib/extension-devices";
import { transportAllowed } from "@/lib/request-security";
import { json, corsPreflight } from "@/lib/http";
import { authorizeBrowserComment, claimBrowserComment, reportBrowserComment } from "@/lib/auto-comment/browser";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const OPTIONS = corsPreflight;
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim"), fbUserId: z.string().regex(/^\d{5,20}$/) }).strict(),
  z.object({ action: z.literal("authorize"), id: z.string().max(100), claimToken: z.string().uuid(), fbUserId: z.string().regex(/^\d{5,20}$/) }).strict(),
  z.object({
    action: z.literal("report"),
    id: z.string().max(100),
    claimToken: z.string().uuid(),
    outcome: z.enum(["observed", "uncertain", "blocked", "failed", "not_sent"]),
    commentUrl: z.string().max(500).optional(),
    reason: z.string().trim().max(80).optional(),
  }).strict(),
  z.object({
    action: z.literal("clear_journal"),
    jobId: z.string().trim().max(100).optional(),
    ownerOutcome: z.enum(["confirmed_sent", "confirmed_not_sent", "still_uncertain", "reviewed"]).optional(),
    note: z.string().trim().max(300).optional(),
  }).strict(),
]);
export async function POST(request: Request) {
  if (!transportAllowed(request.headers, request.url)) return json({ error: "ต้องใช้ HTTPS หรือ localhost" }, 403);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const deviceId = await verifyDeviceToken(token); if (!deviceId) return json({ error: "ต้องจับคู่ Extension ก่อน" }, 401);
  const parsed = input.safeParse(await request.json().catch(() => null)); if (!parsed.success) return json({ error: "คำสั่งไม่ถูกต้อง" }, 400);
  try {
    const data = parsed.data;
    if (data.action === "clear_journal") {
      if (!isCompatibleExtensionVersion(extensionVersionFromRequest(request))) {
        return json({ ok: false, upgradeRequired: true, expectedVersion: EXPECTED_EXTENSION_VERSION });
      }
      const outcome = data.ownerOutcome || "reviewed";
      const job = data.jobId
        ? await prisma.autoCommentJob.findFirst({ where: { id: data.jobId, browserDeviceId: deviceId, deliveryMode: "extension" }, select: { id: true, status: true, ruleId: true, pageId: true, sourceId: true } })
        : null;
      if (data.jobId && !job) return json({ ok: false, error: "ไม่พบงานที่ผูกกับอุปกรณ์นี้" }, 404);
      await prisma.autoCommentLog.create({
        data: {
          jobId: job?.id,
          ruleId: job?.ruleId,
          pageId: job?.pageId || "",
          sourceId: job?.sourceId,
          event: "journal_cleared",
          message: `อุปกรณ์ ${deviceId.slice(0, 12)} บันทึกผลตรวจเจ้าของ=${outcome}${job ? ` งาน=${job.id} สถานะ=${job.status}` : ""}${data.note ? `: ${data.note}` : ""}`,
        },
      });
      const response = json({ ok: true, jobId: job?.id || null, ownerOutcome: outcome });
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    // Claim/authorize prefer the exact expected build; reports and journal clear accept the compatible range.
    if (data.action !== "report" && !isCurrentExtensionVersion(extensionVersionFromRequest(request))) {
      return json({ ...(data.action === "claim" ? { job: null } : { grant: null }), upgradeRequired: true, expectedVersion: EXPECTED_EXTENSION_VERSION });
    }
    if (data.action !== "report" && !(await facebookWorkAllowed(request, data.fbUserId))) {
      return json({ ...(data.action === "claim" ? { job: null } : { grant: null }), accountPaused: true });
    }
    const result = data.action === "claim" ? { job: await claimBrowserComment(deviceId, data.fbUserId) }
      : data.action === "authorize" ? { grant: await authorizeBrowserComment(deviceId, data.id, data.claimToken, data.fbUserId) }
      : { ok: await reportBrowserComment(deviceId, data.id, data.claimToken, data.outcome, data.commentUrl, data.reason) };
    const response = json(result); response.headers.set("Cache-Control", "no-store"); return response;
  } catch { return json({ error: "ประมวลผลงานไม่สำเร็จ ห้ามส่งซ้ำถ้าไม่ทราบผล" }, 503); }
}
