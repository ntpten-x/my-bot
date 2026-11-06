import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

export const CONTROL_KEY = "auto_comment_control";
export type CommentControl = {
  state: "stopped" | "running" | "paused"; dryRun: boolean; emergency: boolean;
  hourlyLimit: number; dailyLimit: number; generation: string; startedAt: string;
  cooldownUntil: string | null;
};
export const defaultControl: CommentControl = {
  state: "stopped", dryRun: true, emergency: false, hourlyLimit: 5, dailyLimit: 20,
  generation: "disabled", startedAt: "9999-12-31T23:59:59.999Z", cooldownUntil: null,
};
export function parseControl(value?: string | null): CommentControl {
  try {
    const data = JSON.parse(value || "null");
    if (!data || !["stopped", "running", "paused"].includes(data.state) || typeof data.dryRun !== "boolean"
      || typeof data.emergency !== "boolean" || typeof data.generation !== "string" || !Number.isFinite(Date.parse(data.startedAt))
      || Date.parse(data.startedAt) > Date.parse(defaultControl.startedAt) || Date.parse(data.startedAt) < Date.parse("0001-01-01T00:00:00.000Z")
      || !Number.isInteger(data.hourlyLimit) || data.hourlyLimit < 1 || data.hourlyLimit > 50
      || !Number.isInteger(data.dailyLimit) || data.dailyLimit < 1 || data.dailyLimit > 200) return { ...defaultControl };
    return { ...defaultControl, ...data };
  } catch { return { ...defaultControl }; }
}
export async function readCommentControl(db: Pick<Prisma.TransactionClient, "setting"> = prisma) {
  return parseControl((await db.setting.findUnique({ where: { key: CONTROL_KEY } }))?.value);
}
export async function lockCommentControl(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`INSERT INTO "Setting" (key, value, "updatedAt") VALUES (${CONTROL_KEY}, ${JSON.stringify(defaultControl)}, now()) ON CONFLICT (key) DO NOTHING`;
  const rows = await tx.$queryRaw<{ value: string }[]>`SELECT value FROM "Setting" WHERE key=${CONTROL_KEY} FOR UPDATE`;
  return parseControl(rows[0]?.value);
}
export async function storeCommentControl(tx: Prisma.TransactionClient, control: CommentControl) {
  await tx.setting.update({ where: { key: CONTROL_KEY }, data: { value: JSON.stringify(control) } });
}
export async function updateCommentControl(input: {
  action?: "start" | "pause" | "stop" | "emergency" | "reset";
  dryRun?: boolean; hourlyLimit?: number; dailyLimit?: number; liveAcknowledged?: boolean;
}) {
  return prisma.$transaction(async tx => {
    const old = await lockCommentControl(tx);
    if (input.dryRun === false && old.dryRun && input.liveAcknowledged !== true) throw new Error("ยืนยันการส่งจริงผ่าน API ก่อนปิด Dry Run");
    if (input.action === "start" && old.emergency) throw new Error("ต้องปลด Emergency Stop ขณะระบบหยุดก่อน");
    if (input.action === "reset" && old.state !== "stopped") throw new Error("ปลด Emergency Stop ได้เฉพาะขณะหยุด");
    const invalidate = input.action === "stop" || input.action === "emergency" || (input.dryRun !== undefined && input.dryRun !== old.dryRun);
    const fresh = input.action === "start" && old.state === "stopped";
    const next: CommentControl = {
      ...old,
      ...(input.dryRun !== undefined ? { dryRun: input.dryRun } : {}),
      ...(input.hourlyLimit !== undefined ? { hourlyLimit: input.hourlyLimit } : {}),
      ...(input.dailyLimit !== undefined ? { dailyLimit: input.dailyLimit } : {}),
      ...(input.action === "start" ? { state: "running" as const } : {}),
      ...(input.action === "pause" ? { state: "paused" as const } : {}),
      ...(input.action === "stop" || input.action === "emergency" || invalidate ? { state: "stopped" as const } : {}),
      ...(input.action === "emergency" ? { emergency: true } : {}),
      ...(input.action === "reset" ? { emergency: false } : {}),
      ...(invalidate || fresh ? { generation: randomUUID(), startedAt: new Date().toISOString() } : {}),
    };
    await storeCommentControl(tx, next);
    if (invalidate) await tx.autoCommentJob.updateMany({ where: { status: { in: ["pending", "pending_ai", "browser_ready", "claimed"] } }, data: { status: "cancelled", claimToken: null, claimUntil: null, lastError: "เจ้าของหยุดระบบหรือเปลี่ยนโหมด" } });
    await tx.autoCommentLog.create({ data: { event: input.action || "settings", message: next.dryRun ? "Dry Run" : "ส่งจริงผ่าน API" } });
    return next;
  }, { timeout: 20_000, maxWait: 20_000 });
}
export function mayRun(control: CommentControl, now = new Date()) {
  return control.state === "running" && !control.emergency && (!control.cooldownUntil || Date.parse(control.cooldownUntil) <= now.getTime());
}
