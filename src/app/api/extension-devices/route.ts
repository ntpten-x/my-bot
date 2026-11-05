import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { listDevices } from "@/lib/extension-devices";
import { APP_VERSION } from "@/lib/version";
import { EXTENSION_VERSION } from "@/lib/extension-package";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const heartbeat = await prisma.extensionHeartbeat.findFirst({ orderBy: { lastSeenAt: "desc" }, select: { version: true, lastSeenAt: true } });
  return json({
    devices: await listDevices(),
    extensionVersion: EXTENSION_VERSION,
    appVersion: APP_VERSION,
    installedVersion: heartbeat?.version || null,
    installedSeenAt: heartbeat?.lastSeenAt?.toISOString() ?? null,
  });
}