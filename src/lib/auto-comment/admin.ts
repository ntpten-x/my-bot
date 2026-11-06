import { z } from "zod";
import { prisma } from "../prisma";
import { encryptSecret } from "../ai/secret-box";
import { autoCommentRuleSchema } from "./schema";
import { lockCommentControl } from "./control";

export async function saveCommentRule(input: z.infer<typeof autoCommentRuleSchema>, id?: string) {
  return prisma.$transaction(async tx => {
    await lockCommentControl(tx); // Serialize configuration changes with the final send gate.
    if (!id && await tx.autoCommentRule.count() >= 30) throw new Error("สร้างได้สูงสุด 30 กฎ");
    if (id && !await tx.autoCommentRule.findUnique({ where: { id } })) throw new Error("ไม่พบกฎ");
    if (input.deliveryMode === "extension" && input.enabled) {
      if (!await tx.extensionDevice.findFirst({ where: { id: input.browserDeviceId, revokedAt: null } })) throw new Error("ไม่พบอุปกรณ์ที่ใช้ส่ง");
      if (await tx.source.count({ where: { id: { in: input.sourceIds }, type: { not: "facebook_group" } } })) throw new Error("Extension ส่งอัตโนมัติเฉพาะกลุ่มที่เลือก");
    }
    const sourceIds = [...new Set(input.sourceIds)];
    if ((await tx.source.count({ where: { id: { in: sourceIds } } })) !== sourceIds.length) throw new Error("แหล่งข้อมูลใน Allowlist ไม่ถูกต้อง");
    if (input.pageId) {
      const url = `https://www.facebook.com/${input.pageId}`;
      const source = await tx.source.upsert({ where: { url }, update: {}, create: { url, type: "facebook_page", name: `เพจ ${input.pageId}` } });
      if (source.type !== "facebook_page") throw new Error("URL นี้มีแหล่งชนิดอื่นอยู่แล้ว ต้องตรวจแหล่งข้อมูลก่อน");
      if (!sourceIds.includes(source.id)) sourceIds.push(source.id);
    }
    const { pageToken, managerToken, clearCredentials, templates, days, sourceIds: _sources, ...data } = input;
    void _sources;
    const secrets = clearCredentials || input.deliveryMode === "extension" ? { pageTokenEnc: null, managerTokenEnc: null } : {
      ...(pageToken?.trim() ? { pageTokenEnc: encryptSecret(pageToken.trim()) } : {}),
      ...(managerToken?.trim() ? { managerTokenEnc: encryptSecret(managerToken.trim()) } : {}),
    };
    const value = { ...data, ...secrets, sourceIdsJson: JSON.stringify(sourceIds), daysJson: JSON.stringify([...new Set(days)]), pausedReason: "" };
    const rule = id
      ? await tx.autoCommentRule.update({ where: { id }, data: { ...value, revision: { increment: 1 } } })
      : await tx.autoCommentRule.create({ data: value });
    if (id) {
      await tx.autoCommentJob.updateMany({ where: { ruleId: id, status: { in: ["pending", "pending_ai", "browser_ready", "claimed"] } }, data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: "กฎถูกแก้ไข" } });
      await tx.autoCommentTemplate.deleteMany({ where: { ruleId: id } });
    }
    await tx.autoCommentTemplate.createMany({ data: templates.map((body, sortOrder) => ({ ruleId: rule.id, body, sortOrder })) });
    await tx.autoCommentLog.create({ data: { ruleId: rule.id, event: id ? "rule_updated" : "rule_created", message: rule.enabled ? "เปิดกฎ" : "กฎยังปิดอยู่" } });
    return rule.id;
  });
}
