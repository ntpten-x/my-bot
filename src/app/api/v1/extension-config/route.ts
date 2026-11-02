import { prisma } from "@/lib/prisma";
import { requireExtensionToken } from "@/lib/auth";
import { corsPreflight, json, withCors } from "@/lib/http";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return corsPreflight();
}

export async function GET(request: Request) {
  if (!(await requireExtensionToken(request.headers.get("authorization")))) {
    return withCors(json({ error: "โทเคนไม่ถูกต้อง" }, 401));
  }
  const settings = await getSettings();
  const groups = await prisma.source.findMany({
    where: { type: "facebook_group", enabled: true },
    orderBy: { name: "asc" },
  });
  return withCors(
    json({
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        url: group.url,
        intervalMinutes: group.intervalMinutes,
        lastFetchedAt: group.lastFetchedAt?.toISOString() ?? null,
      })),
      maxGroupsPerCycle: settings.maxGroupsPerCycle,
      defaultIntervalMinutes: settings.fetchIntervalMinutes,
      jitterMinutes: settings.jitterMinutes,
      mode: "read-only",
    }),
  );
}
