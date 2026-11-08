import { authed } from "@/lib/guard";
import { prisma } from "@/lib/prisma";
import { json } from "@/lib/http";
import { accountPresence, pausedFacebookIds } from "@/lib/facebook-accounts";
import { EXPECTED_EXTENSION_VERSION } from "@/lib/extension-heartbeat";

export const dynamic = "force-dynamic";
export async function GET() {
  const { error } = await authed(); if (error) return error;
  const [accounts, installs, paused] = await Promise.all([
    prisma.fbAccount.findMany({ orderBy: { lastSeenAt: "desc" } }),
    prisma.extensionHeartbeat.findMany({ orderBy: { lastSeenAt: "desc" } }),
    pausedFacebookIds(),
  ]);
  const result = accounts.map(account => {
    const presence = accountPresence(account.id, installs);
    const devices = installs.filter(row => row.fbUserId === account.id).map(row => ({
      id: row.id, browser: row.browser, profileLabel: row.profileLabel, lastSeenAt: row.lastSeenAt.toISOString(),
      loggedIn: row.fbLoggedIn, localEnabled: row.enabled, connected: presence.liveInstallIds.includes(row.id),
      version: row.version, currentVersion: row.version === EXPECTED_EXTENSION_VERSION,
    }));
    const enabled = !paused.has(account.id);
    const current = devices.some(row => row.connected && row.localEnabled && row.currentVersion);
    return { id: account.id, name: account.name, browser: account.browser, profileLabel: account.profileLabel,
      enabled, connected: presence.connected, localEnabled: presence.localEnabled,
      status: !enabled ? "paused" : !presence.connected ? "offline" : !presence.localEnabled ? "local_paused" : !current ? "upgrade_required" : "ready",
      postsCaptured: account.postsCaptured, firstSeenAt: account.firstSeenAt.toISOString(), lastSeenAt: account.lastSeenAt.toISOString(), devices };
  });
  const response = json({ accounts: result, checkedAt: new Date().toISOString(), onlineWindowSeconds: 180 });
  response.headers.set("Cache-Control", "no-store"); return response;
}
