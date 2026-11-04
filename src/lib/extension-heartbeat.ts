import { z } from "zod";
import { prisma } from "./prisma";
import { upsertSettings } from "./settings";
import { touchExtension } from "./extension-status";

// Version this MY-BOT build expects from extension/manifest.json (tests keep the two in sync).
export const EXPECTED_EXTENSION_VERSION = "1.4.1";

const FB_ID = /^\d{5,20}$/;

function epochToDate(value: number | null | undefined) {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  // Ignore clocks far in the future.
  return date.getTime() > Date.now() + 5 * 60 * 1000 ? new Date() : date;
}

export const heartbeatSchema = z.object({
  installId: z.string().trim().min(4).max(80),
  version: z.string().trim().max(20).default(""),
  browser: z.string().trim().max(60).default(""),
  profileLabel: z.string().trim().max(60).default(""),
  enabled: z.boolean().default(false),
  fb: z
    .object({
      loggedIn: z.boolean().default(false),
      id: z.string().trim().max(30).default(""),
      name: z.string().trim().max(120).default(""),
      checkedAt: z.number().nonnegative().default(0),
    })
    .default({ loggedIn: false, id: "", name: "", checkedAt: 0 }),
  tabs: z
    .array(z.object({ title: z.string().max(300).default(""), url: z.string().max(400).default("") }))
    .max(30)
    .default([]),
  lastError: z
    .object({ message: z.string().max(500).default(""), at: z.number().nonnegative().default(0) })
    .nullable()
    .optional(),
  lastPostAt: z.number().nonnegative().default(0),
  postsSent: z.number().int().nonnegative().default(0),
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;

export function normalizeHeartbeat(input: HeartbeatInput) {
  const fbId = input.fb.loggedIn && FB_ID.test(input.fb.id) ? input.fb.id : null;
  const tabs = input.tabs
    .filter((tab) => /^https:\/\/([a-z]+\.)?facebook\.com\//i.test(tab.url))
    .map((tab) => ({ title: tab.title.slice(0, 120), url: tab.url.split("?")[0].slice(0, 200) }));
  return {
    id: input.installId,
    version: input.version,
    browser: input.browser,
    profileLabel: input.profileLabel,
    enabled: input.enabled,
    fbLoggedIn: Boolean(fbId),
    fbUserId: fbId,
    fbUserName: fbId ? input.fb.name.replace(/\s+/g, " ").trim().slice(0, 80) : "",
    fbCheckedAt: epochToDate(input.fb.checkedAt),
    tabsJson: JSON.stringify(tabs),
    lastError: input.lastError?.message?.slice(0, 300) ?? "",
    lastErrorAt: epochToDate(input.lastError?.at),
    lastPostAt: epochToDate(input.lastPostAt),
    postsSent: input.postsSent,
  };
}

export async function recordHeartbeat(input: HeartbeatInput) {
  const row = normalizeHeartbeat(input);
  const now = new Date();
  await prisma.extensionHeartbeat.upsert({
    where: { id: row.id },
    update: { ...row, lastSeenAt: now },
    create: { ...row, lastSeenAt: now },
  });
  if (row.fbUserId) {
    const existing = await prisma.fbAccount.findUnique({ where: { id: row.fbUserId } });
    await prisma.fbAccount.upsert({
      where: { id: row.fbUserId },
      update: {
        name: row.fbUserName || existing?.name || "",
        browser: row.browser,
        profileLabel: row.profileLabel,
        installId: row.id,
        loggedIn: true,
        lastSeenAt: now,
      },
      create: {
        id: row.fbUserId,
        name: row.fbUserName,
        browser: row.browser,
        profileLabel: row.profileLabel,
        installId: row.id,
        loggedIn: true,
        lastSeenAt: now,
      },
    });
  }
  // An account that was last seen in this browser but is no longer logged in there.
  await prisma.fbAccount.updateMany({
    where: { installId: row.id, loggedIn: true, ...(row.fbUserId ? { id: { not: row.fbUserId } } : {}) },
    data: { loggedIn: false },
  });
  // Forget installs that have been silent for 30 days.
  await prisma.extensionHeartbeat.deleteMany({ where: { lastSeenAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
  await touchExtension();
  return row;
}

export async function countCapturedPosts(fbUserId: string | undefined | null, inserted: number) {
  if (!fbUserId || !FB_ID.test(fbUserId) || inserted <= 0) return;
  await prisma.fbAccount.upsert({
    where: { id: fbUserId },
    update: { postsCaptured: { increment: inserted }, lastSeenAt: new Date() },
    create: { id: fbUserId, postsCaptured: inserted },
  });
}

let lastBadTokenWrite = 0;

// Something called an extension endpoint with a wrong or missing token (at most one write per minute).
export async function noteBadExtensionToken() {
  if (Date.now() - lastBadTokenWrite < 60_000) return;
  lastBadTokenWrite = Date.now();
  await upsertSettings({ extension_bad_token_at: new Date().toISOString() }).catch(() => undefined);
}
