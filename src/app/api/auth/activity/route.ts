import { authed } from "@/lib/guard";
import { authMutationError } from "@/lib/auth-request";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const csrf = authMutationError(request, false); if (csrf) return csrf;
  const { session, error } = await authed({ allowMfaSetup: true }); if (error) return error;
  if (Date.now() - session!.lastSeenAt.getTime() >= 60_000) await prisma.session.updateMany({ where: { id: session!.id, authVersion: session!.authVersion }, data: { lastSeenAt: new Date() } });
  return json({ ok: true });
}
