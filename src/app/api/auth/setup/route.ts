import { authRateError } from "@/lib/auth-rate";
import { readJson } from "@/lib/request-body";
import { z } from "zod";
import { cookieOptions, createOwner, createSession, ownerExists, SESSION_COOKIE } from "@/lib/auth";
import { bootstrapTokenErrorMessage, bootstrapTokenOk } from "@/lib/bootstrap-token";
import { json } from "@/lib/http";
import { passwordProblems } from "@/lib/password-policy";
import { authMutationError } from "@/lib/auth-request";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/).default("admin"),
  password: z.string().max(200).min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัว"),
  confirm: z.string().max(200),
  bootstrapToken: z.string().max(256).optional(),
});

export async function POST(request: Request) {
  const mutationError = authMutationError(request); if (mutationError) return mutationError;
  const rateError = authRateError(request); if (rateError) return rateError;
  if (await ownerExists()) return json({ error: "ตั้งรหัสผ่านไปแล้ว" }, 409);
  const parsed = bodySchema.safeParse(await readJson(request, 16_384).catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" }, 400);
  if (!bootstrapTokenOk(request, parsed.data.bootstrapToken)) {
    return json({ error: bootstrapTokenErrorMessage() }, 403);
  }
  if (parsed.data.password !== parsed.data.confirm) return json({ error: "รหัสผ่านไม่ตรงกัน" }, 400);
  const problems = passwordProblems(parsed.data.password);
  if (problems.length) return json({ error: `รหัสผ่านยังไม่ปลอดภัย: ต้อง${problems.join(", ")}`, problems }, 400);
  const owner = await createOwner(parsed.data.password, parsed.data.username);
  const token = await createSession(owner.id);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, cookieOptions(request));
  return response;
}
