import { z } from "zod";

const minute = z.number().int().min(0).max(1440);
export const autoCommentRuleSchema = z.object({
  name: z.string().trim().min(1).max(80), enabled: z.boolean().default(false),
  typeProductId: z.string().min(1).optional(),
  replyTemplateIds: z.array(z.string().min(1)).min(1).max(30).optional(),
  sourceIds: z.array(z.string().min(1)).max(100).default([]),
  keywords: z.string().max(1000).default(""), excludeKeywords: z.string().max(1000).default(""),
  keywordMode: z.enum(["any", "all"]).default("any"), selectionMode: z.enum(["sequential", "random"]).default("sequential"),
  intentMode: z.enum(["keyword", "buyer", "seller"]).default("keyword"),
  priority: z.number().int().min(0).max(100).default(0),
  templates: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
  startMinute: z.number().int().min(0).max(1439).default(0), endMinute: minute.default(1440),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).default([0, 1, 2, 3, 4, 5, 6]),
  maxAgeHours: z.number().int().min(1).max(168).default(24),
  areaCooldownSec: z.number().int().min(30).max(86400).default(60),
  pageId: z.string().regex(/^\d{5,30}$|^$/).default(""),
  deliveryMode: z.enum(["official", "extension"]).default("official"),
  browserDeviceId: z.string().max(100).default(""),
  browserFbUserId: z.string().regex(/^\d{5,20}$|^$/).default(""),
  browserConsent: z.boolean().default(false), requireAi: z.boolean().default(false),
  messageMode: z.enum(["template", "ai_draft"]).default("template"),
  businessFacts: z.string().max(4000).default(""), draftInstruction: z.string().max(1000).default(""),
  pageToken: z.string().max(4096).optional(), managerToken: z.string().max(4096).optional(), clearCredentials: z.boolean().optional(),
}).refine(data => data.startMinute !== data.endMinute, "ช่วงเวลาเริ่มและสิ้นสุดต้องต่างกัน")
  .refine(data => data.deliveryMode !== "extension" || !data.enabled || !data.browserConsent || Boolean(data.browserDeviceId && data.browserFbUserId && data.browserConsent && data.sourceIds.length), "ต้องเลือกอุปกรณ์ บัญชี และยืนยันสิทธิ์ใช้งานกลุ่มก่อนเปิดกฎ")
  .refine(data => data.messageMode !== "ai_draft" || data.requireAi, "ข้อความ AI ต้องรอผลวิเคราะห์ก่อน")
  .refine(data => data.messageMode === "ai_draft" || (data.templates.length > 0 || Boolean(data.typeProductId && data.replyTemplateIds?.length)), "ต้องมีข้อความสำเร็จรูปอย่างน้อยหนึ่งข้อความ")
  .refine(data => Boolean(data.pageId) || data.sourceIds.length > 0, "ต้องเลือกแหล่งข้อมูลหรือกำหนด Page ID ใน Allowlist")
  .refine(data => {
    if (!data.enabled) return true;
    if (data.intentMode !== "keyword" || data.messageMode !== "template" || data.deliveryMode !== "extension") return true;
    return data.keywords.split(/[,\n]/).map(word => word.trim()).filter(Boolean).length > 0;
  }, "กฎคอมเมนต์คำสำคัญต้องมีคำสำคัญอย่างน้อยหนึ่งคำก่อนเปิดใช้งาน");
export const commentControlSchema = z.object({
  action: z.enum(["start", "pause", "stop", "emergency", "reset"]).optional(),
  dryRun: z.literal(false).optional(), hourlyLimit: z.number().int().min(1).max(50).optional(),
  dailyLimit: z.number().int().min(1).max(200).optional(), liveAcknowledged: z.boolean().optional(),
});
