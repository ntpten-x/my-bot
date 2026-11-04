import { z } from "zod";

export const replyQueueSettingsSchema = z.object({
  enabled: z.boolean(),
  times: z.string().max(80),
  dailyCap: z.number().int().min(1).max(100),
  gapMinMinutes: z.number().int().min(0).max(120),
  gapMaxMinutes: z.number().int().min(0).max(180),
  authorDays: z.number().int().min(0).max(90),
  groupDailyCap: z.number().int().min(1).max(50),
  minScore: z.number().int().min(0).max(100),
  autoAdvance: z.boolean().optional(),
  autoMarkSent: z.boolean().optional(),
  autoInsert: z.boolean().optional(),
});

export const REPLY_TEXT_MAX = 2000;

// Panel actions on one queue item. "edit" changes the draft before it is inserted.
export const replyItemActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sent"), text: z.string().max(REPLY_TEXT_MAX).optional() }),
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("edit"), text: z.string().trim().min(1).max(REPLY_TEXT_MAX) }),
]);

// Calls from the browser extension (bearer token). The extension only reports what the owner did.
export const extensionReplySchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("finish"),
    itemId: z.string().max(64).optional(),
    postId: z.string().max(64).optional(),
    action: z.enum(["sent", "skip"]),
    text: z.string().max(REPLY_TEXT_MAX).optional(),
    detected: z.boolean().optional(),
  }),
  z.object({ op: z.literal("next") }),
  z.object({ op: z.literal("status") }),
]);
