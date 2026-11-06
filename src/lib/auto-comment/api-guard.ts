import { authed } from "../guard";
import { json } from "../http";
import { selfOriginOf } from "../request-security";

export async function commentMutationGuard(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const origin = request.headers.get("origin");
  if (origin && origin !== selfOriginOf(request.headers, request.url)) return json({ error: "อนุญาตการเปลี่ยนค่าจากหน้า MY-BOT นี้เท่านั้น" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "ต้องส่งข้อมูล JSON" }, 415);
  return null;
}
