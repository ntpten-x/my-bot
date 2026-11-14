import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { revokeDevice } from "@/lib/extension-devices";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authed({ recent: true });
  if (error) return error;
  const { id } = await context.params;
  if (!(await revokeDevice(id))) return json({ error: "ไม่พบอุปกรณ์" }, 404);
  return json({ ok: true });
}