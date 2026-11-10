import { RULE_ARCHIVE_PREFIX, ruleArchived } from "./rule-archive";
import { TYPE_SETUP_PREFIX, readTypeSetup } from "./type-setup";
import { z } from "zod";
import { prisma } from "../prisma";
import { encryptSecret } from "../ai/secret-box";
import { autoCommentRuleSchema } from "./schema";
import { lockCommentControl } from "./control";

export class RuleSetupError extends Error {}

export async function saveCommentRule(input: z.infer<typeof autoCommentRuleSchema>, id?: string) {
  return prisma.$transaction(async tx => {
    await lockCommentControl(tx); // Serialize configuration changes with the final send gate.
    if (!id) {
      const archived = await tx.setting.findMany({ where: { key: { startsWith: RULE_ARCHIVE_PREFIX }, value: "1" }, select: { key: true } });
      if (await tx.autoCommentRule.count({ where: { id: { notIn: archived.map(row => row.key.slice(RULE_ARCHIVE_PREFIX.length)) } } }) >= 30) throw new RuleSetupError("สร้างได้สูงสุด 30 กฎที่ยังไม่ลบ");
    }
    if (id && await ruleArchived(tx, id)) throw new RuleSetupError("ชุดตั้งค่านี้ถูกลบแล้ว");
    if (id && !await tx.autoCommentRule.findUnique({ where: { id } })) throw new Error("ไม่พบกฎ");
    if (input.deliveryMode === "extension" && input.enabled && input.browserConsent) {
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
    const { pageToken, managerToken, clearCredentials, templates, days, sourceIds: _sources, typeProductId, replyTemplateIds, ...data } = input;
    let snapshots = templates.map(body => ({ body, imagePath: null as string | null }));
    if (typeProductId) {
      if (input.deliveryMode !== "extension" || input.messageMode !== "template") throw new RuleSetupError("กฎตามประเภทต้องส่งข้อความผ่านส่วนขยาย");
      const product = await tx.product.findUnique({ where: { id: typeProductId } });
      if (!product?.enabled) throw new RuleSetupError("ไม่พบประเภทที่เปิดใช้งาน");
      const category = await tx.category.findFirst({ where: { slug: product.categorySlug, parentId: null } });
      if (!category) throw new RuleSetupError("ไม่พบหมวดหมู่ของประเภทนี้");
      const selectedSources = await tx.source.findMany({ where: { id: { in: sourceIds } } });
      if (!sourceIds.length || selectedSources.some(source => source.type !== "facebook_group" || source.defaultProductId !== product.id || source.boundCategorySlug !== product.categorySlug)) throw new RuleSetupError("กลุ่มต้องอยู่ในประเภทที่เลือก");
      const ids = [...new Set(replyTemplateIds ?? [])];
      const messages = await tx.replyTemplate.findMany({ where: { id: { in: ids } } });
      if (!ids.length || messages.length !== ids.length || messages.some(message => message.categoryId !== category.id || (message.productId && message.productId !== product.id) || Boolean(message.sourceIds))) throw new RuleSetupError("ข้อความต้องใช้กับประเภทที่เลือกและไม่เจาะจงกลุ่มอื่น");
      snapshots = ids.map(id => {
        const message = messages.find(row => row.id === id)!;
        return { body: message.body.trim(), imagePath: message.imagePath || null };
      });
      if (snapshots.some(row => !row.body || row.body.length > 2000)) throw new RuleSetupError("ข้อความต้องยาว 1–2,000 ตัวอักษร");
      if (input.browserFbUserId && !await tx.fbAccount.findUnique({ where: { id: input.browserFbUserId } })) throw new RuleSetupError("เลือกบัญชี Facebook ที่ระบบเคยเชื่อมต่อ");
      if (input.browserDeviceId && !await tx.extensionDevice.findFirst({ where: { id: input.browserDeviceId, revokedAt: null } })) throw new RuleSetupError("ไม่พบอุปกรณ์ที่ใช้ส่ง");

    } else if (replyTemplateIds?.length) throw new RuleSetupError("เลือกประเภทก่อนเลือกข้อความ");
    void _sources;
    const secrets = clearCredentials || input.deliveryMode === "extension" ? { pageTokenEnc: null, managerTokenEnc: null } : {
      ...(pageToken?.trim() ? { pageTokenEnc: encryptSecret(pageToken.trim()) } : {}),
      ...(managerToken?.trim() ? { managerTokenEnc: encryptSecret(managerToken.trim()) } : {}),
    };
    const value = { ...data, ...secrets, sourceIdsJson: JSON.stringify(sourceIds), daysJson: JSON.stringify([...new Set(days)]), pausedReason: "" };
    const previous = id
      ? await tx.autoCommentRule.findUnique({ where: { id }, include: { templates: { orderBy: { sortOrder: "asc" } } } })
      : null;
    const preserveQueue = Boolean(previous && isQueuePreservingRuleUpdate(previous, input, snapshots, sourceIds));
    const rule = id
      ? await tx.autoCommentRule.update({ where: { id }, data: { ...value, revision: { increment: 1 } } })
      : await tx.autoCommentRule.create({ data: value });
    if (id && previous) {
      if (preserveQueue) {
        const deviceChanged = previous.browserDeviceId !== input.browserDeviceId || previous.browserFbUserId !== input.browserFbUserId;
        // Retarget waiting work onto the new pin/revision instead of wiping the whole queue.
        await tx.autoCommentJob.updateMany({
          where: { ruleId: id, status: { in: ["pending", "pending_ai", "browser_ready"] } },
          data: {
            ruleRevision: rule.revision,
            ...(deviceChanged ? { browserDeviceId: input.browserDeviceId, browserFbUserId: input.browserFbUserId, nextAttemptAt: new Date(), lastError: "" } : {}),
          },
        });
        // Claimed work still belongs to the old device/revision; never silently reassign mid-flight.
        await tx.autoCommentJob.updateMany({
          where: { ruleId: id, status: "claimed" },
          data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: deviceChanged ? "เปลี่ยนอุปกรณ์ระหว่างเตรียมหน้า" : "กฎถูกแก้ไขระหว่างรับงาน" },
        });
      } else {
        await tx.autoCommentJob.updateMany({ where: { ruleId: id, status: { in: ["pending", "pending_ai", "browser_ready", "claimed"] } }, data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: "กฎถูกแก้ไข" } });
      }
      await tx.autoCommentTemplate.deleteMany({ where: { ruleId: id } });
    }
    if (typeProductId) {
      const key = `${TYPE_SETUP_PREFIX}${rule.id}`, value = JSON.stringify({ productId: typeProductId, templateIds: [...new Set(replyTemplateIds)] });
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    await tx.autoCommentTemplate.createMany({ data: snapshots.map((row, sortOrder) => ({ ruleId: rule.id, body: row.body, imagePath: row.imagePath, sortOrder })) });
    await tx.autoCommentLog.create({
      data: {
        ruleId: rule.id,
        event: id ? "rule_updated" : "rule_created",
        message: id
          ? `${rule.enabled ? "เปิดกฎ" : "กฎยังปิดอยู่"}${preserveQueue ? " · คงคิวงานรอและย้ายอุปกรณ์ถ้าเปลี่ยน" : ""}`
          : (rule.enabled ? "เปิดกฎ" : "กฎยังปิดอยู่"),
      },
    });
    return rule.id;
  });
}

function sameSorted(left: string[], right: string[]) {
  return [...left].map(String).sort().join("\0") === [...right].map(String).sort().join("\0");
}

type TemplateSnapshot = { body: string; imagePath?: string | null };

function templateFingerprint(row: TemplateSnapshot) {
  return `${row.body}\0${row.imagePath || ""}`;
}

/** Keep waiting jobs when the owner only retargets device/schedule/limits, not match text or templates. */
export function isQueuePreservingRuleUpdate(
  previous: { deliveryMode: string; messageMode: string; requireAi: boolean; intentMode: string; keywordMode: string; keywords: string; excludeKeywords: string; selectionMode: string; sourceIdsJson: string; templates: TemplateSnapshot[] },
  input: z.infer<typeof autoCommentRuleSchema>,
  snapshots: TemplateSnapshot[],
  sourceIds: string[],
) {
  if (previous.deliveryMode !== input.deliveryMode || previous.messageMode !== input.messageMode || previous.requireAi !== input.requireAi) return false;
  if (previous.intentMode !== input.intentMode || previous.keywordMode !== input.keywordMode || previous.selectionMode !== input.selectionMode) return false;
  if (previous.keywords !== input.keywords || previous.excludeKeywords !== input.excludeKeywords) return false;
  if (!sameSorted(previous.templates.map(templateFingerprint), snapshots.map(templateFingerprint))) return false;
  let previousSources: string[] = [];
  try { previousSources = JSON.parse(previous.sourceIdsJson) as string[]; } catch { return false; }
  return sameSorted(previousSources, sourceIds);
}

export class RuleToggleError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Toggle the saved configuration without re-reading or replacing its message snapshots. */
export async function setCommentRuleEnabled(id: string, enabled: boolean, revision: number) {
  return prisma.$transaction(async tx => {
    await lockCommentControl(tx);
    const rule = await tx.autoCommentRule.findUnique({ where: { id }, include: { templates: true } });
    if (!rule || await ruleArchived(tx, id)) throw new RuleToggleError("ไม่พบชุดตั้งค่านี้หรือถูกลบแล้ว", 404);
    if (rule.revision !== revision) throw new RuleToggleError("ชุดตั้งค่านี้มีการแก้ไขแล้ว กรุณารีเฟรชรายการก่อน", 409);
    if (rule.enabled === enabled) return { id, enabled, revision: rule.revision };
    if (enabled) {
      if (rule.deliveryMode !== "extension") throw new RuleToggleError("เปิดแก้ไขชุดตั้งค่านี้เพื่อเลือกการส่งผ่านส่วนขยายก่อน");
      if (rule.pausedReason) throw new RuleToggleError("ชุดนี้ถูกพักไว้ กรุณาตรวจประวัติและแก้ไขบันทึกก่อนเปิดใช้งาน");
      if (rule.messageMode !== "template" || !rule.templates.length) throw new RuleToggleError("เลือกข้อความสำเร็จรูปก่อนเปิดชุดนี้");
      const sourceIds = JSON.parse(rule.sourceIdsJson) as string[];
      const sources = await tx.source.findMany({ where: { id: { in: sourceIds } } });
      if (!sourceIds.length || sources.length !== new Set(sourceIds).size || sources.some(source => source.type !== "facebook_group")) throw new RuleToggleError("ตรวจรายการกลุ่มในชุดตั้งค่าก่อนเปิดใช้งาน");
      const typeSetting = await tx.setting.findUnique({ where: { key: `${TYPE_SETUP_PREFIX}${id}` } });
      if (typeSetting) {
        const setup = readTypeSetup(typeSetting.value);
        const product = setup ? await tx.product.findUnique({ where: { id: setup.productId } }) : null;
        if (!product?.enabled || sources.some(source => source.defaultProductId !== product.id || source.boundCategorySlug !== product.categorySlug)) throw new RuleToggleError("มีกลุ่มที่เปลี่ยนประเภทแล้ว กรุณาแก้ไขชุดตั้งค่าก่อน");
      }
    }
    const updated = await tx.autoCommentRule.update({ where: { id }, data: { enabled, revision: { increment: 1 } } });
    await tx.autoCommentJob.updateMany({ where: { ruleId: id, status: { in: ["pending", "pending_ai", "browser_ready", "claimed"] } }, data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: enabled ? "เปิดใช้งานชุดตั้งค่าใหม่" : "เจ้าของปิดชุดตั้งค่านี้" } });
    await tx.autoCommentLog.create({ data: { ruleId: id, event: enabled ? "rule_enabled" : "rule_disabled", message: enabled ? "เปิดใช้งานชุดตั้งค่า" : "ปิดใช้งานชุดตั้งค่า" } });
    return { id, enabled: updated.enabled, revision: updated.revision };
  }, { timeout: 20000, maxWait: 20000 });
}

const DEVICE_ONLINE_MS = 180_000;

type RuntimeState = { at?: string; fbUserId?: string; commentsEnabled?: boolean };

function readDeviceRuntime(raw?: string | null): RuntimeState {
  try { return JSON.parse(raw || "{}") as RuntimeState; } catch { return {}; }
}

function deviceOnline(state: RuntimeState, now: number) {
  return Boolean(state.at && now - Date.parse(state.at) < DEVICE_ONLINE_MS);
}

/**
 * When Desktop reinstall creates a new mbd_ device, retarget enabled rules that still pin an offline
 * device if exactly one live sender matches the same Facebook account.
 */
export async function migrateStaleBrowserDevicePins(now = Date.now()) {
  const rules = await prisma.autoCommentRule.findMany({
    where: { enabled: true, deliveryMode: "extension", browserConsent: true, browserDeviceId: { not: "" }, browserFbUserId: { not: "" }, pausedReason: "" },
    select: { id: true, browserDeviceId: true, browserFbUserId: true, revision: true },
  });
  if (!rules.length) return [] as string[];
  const devices = await prisma.extensionDevice.findMany({ where: { revokedAt: null }, select: { id: true } });
  const settings = await prisma.setting.findMany({ where: { key: { in: devices.map(row => `extension_runtime_${row.id}`) } } });
  const runtime = new Map(settings.map(row => [row.key.slice("extension_runtime_".length), readDeviceRuntime(row.value)]));
  const migrated: string[] = [];
  for (const rule of rules) {
    const pinned = runtime.get(rule.browserDeviceId) || {};
    if (deviceOnline(pinned, now) && pinned.fbUserId === rule.browserFbUserId) continue;
    const candidates = devices.filter(device => {
      if (device.id === rule.browserDeviceId) return false;
      const state = runtime.get(device.id) || {};
      return deviceOnline(state, now) && state.fbUserId === rule.browserFbUserId && state.commentsEnabled !== false;
    });
    if (candidates.length !== 1) continue;
    const nextId = candidates[0]!.id;
    await prisma.$transaction(async tx => {
      await lockCommentControl(tx);
      const current = await tx.autoCommentRule.findUnique({ where: { id: rule.id } });
      if (!current || current.revision !== rule.revision || current.browserDeviceId !== rule.browserDeviceId) return;
      const updated = await tx.autoCommentRule.update({
        where: { id: rule.id },
        data: { browserDeviceId: nextId, revision: { increment: 1 } },
      });
      await tx.autoCommentJob.updateMany({
        where: { ruleId: rule.id, status: { in: ["pending", "pending_ai", "browser_ready"] } },
        data: { browserDeviceId: nextId, ruleRevision: updated.revision, nextAttemptAt: new Date(), lastError: "" },
      });
      await tx.autoCommentJob.updateMany({
        where: { ruleId: rule.id, status: "claimed" },
        data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: "ย้ายไปอุปกรณ์ที่ออนไลน์" },
      });
      await tx.autoCommentLog.create({
        data: { ruleId: rule.id, event: "device_migrated", message: `ย้ายจากอุปกรณ์ออฟไลน์ไปยังเครื่องที่ออนไลน์ของบัญชีเดียวกัน` },
      });
      migrated.push(rule.id);
    });
  }
  return migrated;
}

/** Remove from the active list while retaining jobs, message snapshots and idempotency history. */
export async function deleteCommentRule(id: string, revision: number) {
  return prisma.$transaction(async tx => {
    await lockCommentControl(tx);
    const rule = await tx.autoCommentRule.findUnique({ where: { id } });
    if (!rule) throw new RuleToggleError("ไม่พบชุดตั้งค่านี้", 404);
    if (await ruleArchived(tx, id)) return { ok: true };
    if (rule.revision !== revision) throw new RuleToggleError("ชุดตั้งค่านี้มีการแก้ไขแล้ว กรุณารีเฟรชก่อนลบ", 409);
    await tx.autoCommentRule.update({ where: { id }, data: { enabled: false, revision: { increment: 1 } } });
    await tx.autoCommentJob.updateMany({ where: { ruleId: id, status: { in: ["pending", "pending_ai", "browser_ready", "claimed"] } }, data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: "เจ้าของลบชุดตั้งค่านี้" } });
    const key = `${RULE_ARCHIVE_PREFIX}${id}`;
    await tx.setting.upsert({ where: { key }, create: { key, value: "1" }, update: { value: "1" } });
    await tx.autoCommentLog.create({ data: { ruleId: id, event: "rule_deleted", message: "ลบชุดตั้งค่าออกจากรายการ โดยเก็บประวัติการส่งไว้" } });
    return { ok: true };
  }, { timeout: 20000, maxWait: 20000 });
}
