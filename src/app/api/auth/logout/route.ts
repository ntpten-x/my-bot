import { cookieOptions, destroySession, SESSION_COOKIE } from "@/lib/auth";
import { json } from "@/lib/http";
import { authMutationError } from "@/lib/auth-request";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const mutationError = authMutationError(request, false); if (mutationError) return mutationError;
  await destroySession();
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions(request), maxAge: 0 });
  return response;
}
