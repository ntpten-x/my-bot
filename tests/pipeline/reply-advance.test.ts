import { describe, expect, it } from "vitest";
import { ADVANCE_REASON_TH, advanceDecision } from "../../src/lib/reply-queue-core";
import { extensionReplySchema, replyItemActionSchema, replyQueueSettingsSchema } from "../../src/lib/reply-queue-schema";
import { shortcutFor } from "../../src/lib/reply-shortcuts";

describe("auto-advance decision", () => {
  const base = { hasNext: true, hasOpen: false, openedToday: 2, cap: 10, waitMs: 0 };

  it("opens now when the gap passed and the cap allows", () => {
    expect(advanceDecision(base)).toEqual({ state: "ready", waitMs: 0 });
  });

  it("waits for the gap timer", () => {
    expect(advanceDecision({ ...base, waitMs: 90_000 })).toEqual({ state: "wait", waitMs: 90_000 });
  });

  it("never advances past the daily cap, an unfinished item or an empty queue", () => {
    expect(advanceDecision({ ...base, openedToday: 10, waitMs: 5000 })).toMatchObject({ state: "blocked", reason: "cap" });
    expect(advanceDecision({ ...base, hasOpen: true })).toMatchObject({ state: "blocked", reason: "open" });
    expect(advanceDecision({ ...base, hasNext: false })).toMatchObject({ state: "blocked", reason: "empty" });
    expect(ADVANCE_REASON_TH.cap).toBeTruthy();
  });
});

describe("reply action schemas", () => {
  it("accepts sent with an edited text, skip, and edit with text", () => {
    expect(replyItemActionSchema.parse({ action: "sent", text: "ok" })).toEqual({ action: "sent", text: "ok" });
    expect(replyItemActionSchema.parse({ action: "skip" })).toEqual({ action: "skip" });
    expect(replyItemActionSchema.safeParse({ action: "edit" }).success).toBe(false);
    expect(replyItemActionSchema.safeParse({ action: "edit", text: "x".repeat(2001) }).success).toBe(false);
    expect(replyItemActionSchema.safeParse({ action: "post" }).success).toBe(false);
  });

  it("only lets the extension finish, ask for the next lead, or read status", () => {
    expect(extensionReplySchema.safeParse({ op: "finish", itemId: "a", action: "sent", detected: true }).success).toBe(true);
    expect(extensionReplySchema.safeParse({ op: "finish", itemId: "a", action: "comment" }).success).toBe(false);
    expect(extensionReplySchema.safeParse({ op: "next" }).success).toBe(true);
    expect(extensionReplySchema.safeParse({ op: "post" }).success).toBe(false);
  });

  it("keeps the new toggles optional", () => {
    const base = { enabled: true, times: "09:00", dailyCap: 10, gapMinMinutes: 3, gapMaxMinutes: 8, authorDays: 7, groupDailyCap: 3, minScore: 50 };
    expect(replyQueueSettingsSchema.safeParse(base).success).toBe(true);
    expect(replyQueueSettingsSchema.parse({ ...base, autoAdvance: false, autoMarkSent: true, autoInsert: true })).toMatchObject({ autoAdvance: false, autoMarkSent: true, autoInsert: true });
  });
});

describe("queue panel keyboard shortcuts", () => {
  it("maps N/S/K/E (any case or keyboard layout)", () => {
    expect(shortcutFor({ key: "n" })).toBe("next");
    expect(shortcutFor({ key: "S" })).toBe("sent");
    expect(shortcutFor({ key: "า", code: "KeyK" })).toBe("skip");
    expect(shortcutFor({ key: "ำ", code: "KeyE" })).toBe("edit");
    expect(shortcutFor({ key: "x" })).toBeNull();
    expect(shortcutFor({ key: "Enter" })).toBeNull();
  });

  it("ignores keys while typing or with modifiers held", () => {
    expect(shortcutFor({ key: "s", targetTag: "TEXTAREA" })).toBeNull();
    expect(shortcutFor({ key: "s", targetTag: "input" })).toBeNull();
    expect(shortcutFor({ key: "s", targetTag: "SELECT" })).toBeNull();
    expect(shortcutFor({ key: "s", targetEditable: true })).toBeNull();
    expect(shortcutFor({ key: "s", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "n", metaKey: true })).toBeNull();
    expect(shortcutFor({ key: "k", altKey: true })).toBeNull();
    expect(shortcutFor({ key: "n", repeat: true })).toBeNull();
  });
});
