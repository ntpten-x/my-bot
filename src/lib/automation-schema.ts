import { z } from "zod";

/** Overall cap; a game can hold many sets (e.g. Roblox ข้อความ 1–9). */
export const MAX_TEMPLATES = 300;
/** Per scope (same category + product + groups). */
export const MAX_TEMPLATES_PER_SCOPE = 50;

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(2000),
  categoryId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  sourceIds: z.array(z.string().min(1)).max(100).optional(),
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
  subcategoryId: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  sourceIds: z.array(z.string().min(1)).max(200).optional(),
  excludeKeywords: z.string().max(500).optional(),
  maxAgeHours: z.number().int().min(0).max(168).optional(),
  priority: z.number().int().min(0).max(999).optional(),
  actionQueue: z.boolean().optional(),
  templateIds: z.array(z.string().min(1)).max(100).optional(),
});

/** Turns the API body into Prisma data (arrays → comma lists, "" → null). */
export function ruleData<T extends Partial<z.infer<typeof ruleSchema>>>(input: T) {
  const { sourceIds, templateIds, ...rest } = input;
  const nullable = (key: "categoryId" | "templateId" | "subcategoryId" | "productId") =>
    rest[key] !== undefined ? { [key]: rest[key] || null } : {};
  return {
    ...rest,
    ...nullable("categoryId"),
    ...nullable("templateId"),
    ...nullable("subcategoryId"),
    ...nullable("productId"),
    ...(sourceIds !== undefined ? { sourceIds: sourceIds.join(",") } : {}),
    ...(templateIds !== undefined ? { templateIds: templateIds.join(",") } : {}),
  };
}
