import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  diskLevel,
  explainAiFailure,
  heartbeatLevel,
  nextDailyRun,
  nextTimesRun,
  scrubSecrets,
  section,
  supabaseLabel,
  tabLifecycleCheck,
  versionLevel,
  workerLevel,
  worstLevel,
} from "@/lib/system-status";
import { EXPECTED_EXTENSION_VERSION, heartbeatSchema, normalizeHeartbeat } from "@/lib/extension-heartbeat";
import { safeChannelMessage } from "@/lib/notify";

const require = createRequire(import.meta.url);
const ext = path.resolve(__dirname, "../../extension");
const identity = require(path.join(ext, "identity.js")) as {
  cookieValue(text: string, name: string): string;
  readFacebookIdentity(doc: unknown): { loggedIn: boolean; id: string; name: string };
};

function fakeDoc(cookie: string, links: { href: string; text?: string; label?: string }[] = []) {
  return {
    cookie,
    querySelectorAll: (selector: string) => {
      const needle = selector.match(/href\*="(\d+)"/)?.[1] ?? "";
      return links
        .filter((link) => link.href.includes(needle))
        .map((link) => ({
          textContent: link.text ?? "",
          getAttribute: (name: string) => (name === "href" ? link.href : name === "aria-label" ? link.label ?? null : null),
        }));
    },
  };
}

describe("facebook identity (extension/identity.js)", () => {
  it("reads only the c_user account id", () => {
    expect(identity.cookieValue("datr=abc; c_user=100012345678; xs=secret", "c_user")).toBe("100012345678");
    const result = identity.readFacebookIdentity(fakeDoc("datr=abc; c_user=100012345678; xs=secret"));
    expect(result).toEqual({ loggedIn: true, id: "100012345678", name: "" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("is logged out without a numeric c_user", () => {
    expect(identity.readFacebookIdentity(fakeDoc("datr=abc")).loggedIn).toBe(false);
    expect(identity.readFacebookIdentity(fakeDoc("c_user=abc")).loggedIn).toBe(false);
  });

  it("finds the display name from the account's own profile link", () => {
    const doc = fakeDoc("c_user=100012345678", [
      { href: "/groups/1/posts/100012345678999", text: "Other person" },
      { href: "https://www.facebook.com/profile.php?id=100012345678", text: "สมชาย ใจดี" },
    ]);
    expect(identity.readFacebookIdentity(doc).name).toBe("สมชาย ใจดี");
  });

  it("manifest version matches what the server expects", () => {
    const manifest = JSON.parse(readFileSync(path.join(ext, "manifest.json"), "utf8")) as {
      version: string;
      permissions: string[];
      content_scripts: { matches: string[]; js: string[] }[];
    };
    expect(manifest.version).toBe(EXPECTED_EXTENSION_VERSION);
    expect(manifest.permissions).not.toContain("cookies");
    const idScript = manifest.content_scripts.find((entry) => entry.js.includes("identity.js"));
    for (const match of idScript?.matches ?? []) expect(match).toMatch(/^https:\/\/(www\.|web\.)?facebook\.com\//);
  });
});

describe("heartbeat payload", () => {
  it("accepts only aggregate lifecycle counters and rejects negative or excessive values", () => {
    const tabs = { activeReaders: 1, activeComments: 0, parkedReaders: 2, closing: 1, idleReaders: 0, released: 3, retryAt: 0 };
    expect(heartbeatSchema.parse({ installId: "synthetic", runtime: { tabs } }).runtime?.tabs).toEqual(tabs);
    expect(heartbeatSchema.safeParse({ installId: "synthetic", runtime: { tabs: { ...tabs, closing: -1 } } }).success).toBe(false);
    expect(heartbeatSchema.safeParse({ installId: "synthetic", runtime: { tabs: { ...tabs, activeReaders: 99999 } } }).success).toBe(false);
  });
  it("keeps a valid account id and drops bad ids and non-facebook tabs", () => {
    const parsed = heartbeatSchema.parse({
      installId: "abcd-1234",
      version: "1.3.0",
      fb: { loggedIn: true, id: "100012345678", name: "  สมชาย   ใจดี ", checkedAt: Date.now() },
      tabs: [
        { title: "กลุ่ม", url: "https://www.facebook.com/groups/123?ref=x" },
        { title: "อื่น", url: "https://example.com/" },
      ],
    });
    const row = normalizeHeartbeat(parsed);
    expect(row.fbUserId).toBe("100012345678");
    expect(row.fbUserName).toBe("สมชาย ใจดี");
    expect(JSON.parse(row.tabsJson)).toEqual([{ title: "กลุ่ม", url: "https://www.facebook.com/groups/123" }]);
    const bad = normalizeHeartbeat(heartbeatSchema.parse({ installId: "abcd-1234", fb: { loggedIn: true, id: "abc" } }));
    expect(bad.fbLoggedIn).toBe(false);
    expect(bad.fbUserId).toBeNull();
  });
});

describe("status helpers", () => {
  const now = Date.parse("2026-11-04T10:00:00Z");
  it("distinguishes waiting cursors, closing failures and absent/old lifecycle telemetry", () => {
    const tabs = { at: new Date(now).toISOString(), version: EXPECTED_EXTENSION_VERSION, activeReaders: 0,
      activeComments: 0, parkedReaders: 2, closing: 0, idleReaders: 0, released: 1 };
    const check = (value: object) => tabLifecycleCheck(JSON.stringify(value), EXPECTED_EXTENSION_VERSION, now);
    expect(check(tabs)).toMatchObject({ level: "ok" });
    expect(check({ ...tabs, closing: 1 })).toMatchObject({ level: "warn" });
    expect(check({ ...tabs, version: "old" })).toMatchObject({ level: "off" });
    expect(check({ ...tabs, at: new Date(now - 180001).toISOString() })).toMatchObject({ level: "off" });
    expect(check({ ...tabs, at: new Date(now + 60000).toISOString() })).toMatchObject({ level: "off" });
    expect(tabLifecycleCheck(undefined, EXPECTED_EXTENSION_VERSION, now).value).toContain("รอข้อมูล");
  });
  it("grades heartbeat and worker age", () => {
    expect(heartbeatLevel(new Date(now - 60_000), now)).toBe("ok");
    expect(heartbeatLevel(new Date(now - 10 * 60_000), now)).toBe("warn");
    expect(heartbeatLevel(new Date(now - 60 * 60_000), now)).toBe("bad");
    expect(heartbeatLevel(null, now)).toBe("bad");
    expect(workerLevel(new Date(now - 90_000).toISOString(), now)).toBe("ok");
    expect(workerLevel(null, now)).toBe("bad");
  });

  it("compares versions", () => {
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.3", "1.3.0")).toBe(0);
    expect(versionLevel("1.2.0", "1.3.0")).toBe("warn");
    expect(versionLevel("", "1.3.0")).toBe("bad");
  });

  it("explains AI failures in Thai", () => {
    expect(explainAiFailure(401).text).toContain("คีย์ไม่ถูกต้อง");
    expect(explainAiFailure(429).text).toContain("ลิมิต");
    expect(explainAiFailure(null, "fetch failed").text).toContain("อินเทอร์เน็ต");
  });

  it("never leaks secrets", () => {
    const text = scrubSecrets(
      "bad gsk_ABCDEF123456 at https://x.test/?key=AIzaSECRET and postgres://u:p@h/db Bearer abc https://discord.com/api/webhooks/1/xyz",
      ["gsk_ABCDEF123456"],
    );
    expect(text).not.toMatch(/gsk_ABCDEF123456|AIzaSECRET|u:p@|Bearer abc|webhooks\/1/);
    expect(safeChannelMessage("Discord ตอบ 404 https://discord.com/api/webhooks/1/abc")).not.toContain("webhooks");
  });

  it("computes the next Bangkok run", () => {
    const at = new Date("2026-11-04T00:30:00Z"); // 07:30 Bangkok
    expect(nextDailyRun("08:00", "2026-11-03", at).toISOString()).toBe("2026-11-04T01:00:00.000Z");
    expect(nextDailyRun("03:00", "2026-11-04", at).toISOString()).toBe("2026-11-04T20:00:00.000Z");
    expect(nextDailyRun("03:00", "2026-11-03", at)).toBe(at);
    expect(nextTimesRun(["18:00", "09:00"], at)?.toISOString()).toBe("2026-11-04T02:00:00.000Z");
    expect(nextTimesRun([], at)).toBeNull();
  });

  it("rolls levels up and labels the database without credentials", () => {
    expect(worstLevel(["ok", "off", "warn"])).toBe("warn");
    expect(worstLevel(["off"])).toBe("off");
    expect(section("x", "X", [{ key: "a", label: "a", level: "bad", value: "" }]).level).toBe("bad");
    const label = supabaseLabel("postgresql://postgres.ref:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres");
    expect(label).toBe("Supabase (ap-southeast-1)");
    expect(label).not.toContain("pw");
    expect(diskLevel(50 * 1024 ** 3, 500 * 1024 ** 3)).toBe("ok");
    expect(diskLevel(1 * 1024 ** 3, 500 * 1024 ** 3)).toBe("bad");
  });
});
