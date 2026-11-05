import { z } from "zod";

export const MAX_TEMPLATES = 50;

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(2000),
  categoryId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const ruleSchema = z.object({
  name: z.string().trim().min(1).max(60),
  enabled: z.boolean().optional(),
  categoryId: z.string().nullable().optional(),
  keywords: z.string().max(500).optional(),
  provinces: z.string().max(1500).optional(),
  intent: z.enum(["", "buyer", "seller", "chat", "unknown"]).optional(),
  minScore: z.number().int().min(0).max(100).optional(),
  actionNotify: z.boolean().optional(),
  actionSave: z.boolean().optional(),
  actionDismiss: z.boolean().optional(),
  templateId: z.string().nullable().optional(),
});
