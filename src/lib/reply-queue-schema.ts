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
});
