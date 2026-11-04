import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { buildExtensionConfig } from "@/lib/scrape-runs";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization")))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  return withCors(json(await buildExtensionConfig()));
}
