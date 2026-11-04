import { prisma } from "@/lib/prisma";
import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { ensureSeeded, publicProvider } from "@/lib/ai/provider-registry";
import { providerData } from "@/lib/ai/provider-input";
import { hasKeySecret } from "@/lib/ai/secret-box";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  await ensureSeeded(await getSettings());
  const rows = await prisma.aiProvider.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const now = new Date();
  return json({ providers: rows.map((row) => publicProvider(row, now)), keySecretReady: hasKeySecret(), now: now.toISOString() });
}

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  const body = await request.json().catch(() => ({}));
  try {
    const data = providerData(body, false);
    const last = await prisma.aiProvider.aggregate({ _max: { priority: true } });
    const row = await prisma.aiProvider.create({
      data: { ...(data as { name: string }), tasks: (data.tasks as string) || "classify", priority: (last._max.priority ?? 0) + 10 },
    });
    return json({ provider: publicProvider(row) }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "บันทึกไม่สำเร็จ" }, 400);
  }
}