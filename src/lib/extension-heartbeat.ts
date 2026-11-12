import { z } from "zod";
import { prisma } from "./prisma";
import { upsertSettings } from "./settings";
import { touchExtension } from "./extension-status";

// Version this MY-BOT build expects from extension/manifest.json (tests keep the two in sync).
export const EXPECTED_EXTENSION_VERSION = "1.11.31";
/** Oldest patch still allowed for scrape/read work within the current minor line. */
export const MINIMUM_EXTENSION_VERSION = "1.11.19";

function parseExtensionVersion(version: string | null | undefined) {
  const match = String(version || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareExtensionVersion(left: string, right: string) {
  const a = parseExtensionVersion(left), b = parseExtensionVersion(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function isCurrentExtensionVersion(version: string | null | undefined) {
  return String(version || "").trim() === EXPECTED_EXTENSION_VERSION;
}

/** Accept the expected minor line from MINIMUM upward (including patches newer than EXPECTED during local rollout). */
export function isCompatibleExtensionVersion(version: string | null | undefined) {
  const value = String(version || "").trim();
  if (!value) return false;
  if (isCurrentExtensionVersion(value)) return true;
  const parsed = parseExtensionVersion(value);
  const expected = parseExtensionVersion(EXPECTED_EXTENSION_VERSION);
  const againstMin = compareExtensionVersion(value, MINIMUM_EXTENSION_VERSION);
  if (!parsed || !expected || againstMin == null || againstMin < 0) return false;
  return parsed.major === expected.major && parsed.minor === expected.minor;
}

export function extensionVersionFromRequest(request: Request) {
  return String(request.headers.get("x-extension-version") || "").trim();
}

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
  errors: z
    .object({
      count24h: z.number().int().nonnegative().default(0),
      log: z
        .array(z.object({ at: z.number().nonnegative().default(0), message: z.string().max(300).default(""), count: z.number().int().positive().default(1) }))
        .max(20)
        .default([]),
    })
    .optional(),
  outboxSize: z.number().int().nonnegative().max(100000).default(0),
  runtime: z
    .object({
      quietReason: z.string().max(160).default(""),
      commentsEnabled: z.boolean().default(false),
      commentPending: z.boolean().default(false),
      tabs: z.object({
        activeReaders: z.number().int().min(0).max(1000),
        activeComments: z.number().int().min(0).max(1),
        parkedReaders: z.number().int().min(0).max(1000),
        closing: z.number().int().min(0).max(1000),
        idleReaders: z.number().int().min(0).max(1000),
        released: z.number().int().min(0).max(1000000),
        retryAt: z.number().nonnegative(),
      }).optional(),
      capture: z.object({
        pendingPosts: z.number().int().min(0).max(100000).default(0),
        oldestPendingAt: z.number().nonnegative().default(0),
        parkedFeeds: z.number().int().min(0).max(1000).default(0),
        journalPending: z.number().int().min(0).max(100000).default(0).optional(),
        outboxRejectedItems: z.number().int().min(0).max(1000000).default(0).optional(),
        journalRejectedItems: z.number().int().min(0).max(1000000).default(0).optional(),
        fullTextOverflow: z.number().int().min(0).max(1000000).default(0).optional(),
        fullTextActive: z.number().int().min(0).max(100000).default(0).optional(),
        fullTextReview: z.number().int().min(0).max(100000).default(0).optional(),
        problemOutbox: z.number().int().min(0).max(100000).default(0).optional(),
      }).optional(),
      reading: z
        .object({
          groupId: z.string().max(80).default(""),
          groupName: z.string().max(120).default(""),
          phase: z.enum(["feed", "detail", "idle"]).default("idle"),
          startedAt: z.number().nonnegative().default(0),
        })
        .nullable()
        .optional(),
    })
    .optional(),
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
    errorCount24h: input.errors?.count24h ?? 0,
    errorLogJson: JSON.stringify((input.errors?.log ?? []).map((entry) => ({ at: entry.at, message: entry.message.slice(0, 200), count: entry.count }))),
    outboxSize: input.outboxSize ?? 0,
  };
}

export async function recordHeartbeat(input: HeartbeatInput, deviceId?: string) {
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
  // When the current extension checks in, drop stale version rows so overview stays clean.
  if (isCurrentExtensionVersion(row.version)) {
    await prisma.extensionHeartbeat.deleteMany({ where: { version: { not: EXPECTED_EXTENSION_VERSION } } });
  }
  await touchExtension();
  if (deviceId) {
    await upsertSettings({ [`extension_runtime_${deviceId}`]: JSON.stringify({ ...(input.runtime ?? {}), fbUserId: row.fbUserId, at: now.toISOString() }) });
  }
  // Single-owner overview: mirror the live "currently reading" status for the dashboard.
  if (input.runtime && "reading" in input.runtime) {
    const reading = input.runtime.reading;
    await upsertSettings({
      extension_reading: reading
        ? JSON.stringify({ ...reading, installId: row.id, at: now.toISOString() })
        : "",
    });
  }
  if (input.runtime?.capture) {
    await upsertSettings({ extension_capture: JSON.stringify({ ...input.runtime.capture, at: now.toISOString() }) });
  }
  // Scope collection diagnostics to the exact heartbeat; stale or other-version
  // runtime must never be interpreted as current progress or an intentional pause.
  await upsertSettings({ extension_collection_status: JSON.stringify({
    installId: row.id, version: row.version, at: now.toISOString(),
    quietReason: input.runtime?.quietReason ?? "",
    capture: input.runtime?.capture ?? null,
  }) });
  if (input.runtime?.tabs) {
    await upsertSettings({ extension_tab_status: JSON.stringify({ ...input.runtime.tabs, version: row.version, at: now.toISOString() }) });
  }
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
