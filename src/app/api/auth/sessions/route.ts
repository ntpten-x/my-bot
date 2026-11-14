import { appendSecurityAudit } from "@/lib/security-audit";
import { readJson } from "@/lib/request-body";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { authMutationError } from "@/lib/auth-request";

export const dynamic = "force-dynamic";
export async function GET() {
  const { session, error } = await authed({ allowMfaSetup: true }); if (error) return error;
  const now = new Date();
  const sessions = await prisma.session.findMany({ where: { ownerId: session!.ownerId, expiresAt: { gt: now } }, select: { id: true, createdAt: true, expiresAt: true }, orderBy: { createdAt: "desc" }, take: 50 });
  return Response.json({ sessions: sessions.map(row => ({ ...row, current: row.id === session!.id })) }, { headers: { "Cache-Control": "no-store" } });
}
export async function DELETE(request: Request) {
  const mutationError = authMutationError(request); if (mutationError) return mutationError;
  const { session, error } = await authed({ recent: true, allowMfaSetup: true }); if (error) return error;
  const input = z.object({ id: z.string().min(1).max(200) }).strict().safeParse(await readJson(request, 16_384).catch(() => null));
  if (!input.success) return Response.json({ error: "ระบุเซสชันที่ต้องการออกจากระบบ" }, { status: 400 });
  if (input.data.id === session!.id) return Response.json({ error: "ใช้ปุ่มออกจากระบบสำหรับเครื่องนี้" }, { status: 400 });
  await prisma.$transaction(async tx => {
    await tx.session.deleteMany({ where: { id: input.data.id, ownerId: session!.ownerId } });
    await appendSecurityAudit("session.revoked", session!.ownerId, "success", tx);
  });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
