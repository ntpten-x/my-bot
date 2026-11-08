import type { Prisma } from "@prisma/client";
import type { CommentControl } from "./control";

export type DispatchDelay = { retryAt: Date; reason: string };
export function combineDispatchDelays(delays: (DispatchDelay | null)[]): DispatchDelay | null {
  const active = delays.filter((delay): delay is DispatchDelay => Boolean(delay));
  return active.length ? { retryAt: new Date(Math.max(...active.map(delay => delay.retryAt.getTime()))), reason: active.map(delay => delay.reason).join(", ") } : null;
}

/** Checked under the global control lock, at claim and again immediately before the send marker. */
export async function globalDispatchDelay(tx: Prisma.TransactionClient, control: CommentControl, now: Date): Promise<DispatchDelay | null> {
  const local = new Date(now.getTime() + 7 * 3600000);
  const dayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 7 * 3600000);
  const [hour, day, sending] = await Promise.all([
    tx.autoCommentLog.findMany({ where: { event: "dispatch", createdAt: { gte: new Date(now.getTime() - 3600000) } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    tx.autoCommentLog.count({ where: { event: "dispatch", createdAt: { gte: dayStart } } }),
    tx.autoCommentJob.findFirst({ where: { deliveryMode: "extension", status: "sending", claimUntil: { gt: now } }, select: { claimUntil: true } }),
  ]);
  return combineDispatchDelays([
    hour.length >= control.hourlyLimit ? { retryAt: new Date(hour[hour.length - control.hourlyLimit].createdAt.getTime() + 3600001), reason: "รอโควตารายชั่วโมง" } : null,
    day >= control.dailyLimit ? { retryAt: new Date(dayStart.getTime() + 86400001), reason: "รอโควตารายวัน" } : null,
    sending ? { retryAt: new Date(Math.min(sending.claimUntil!.getTime() + 1, now.getTime() + 5000)), reason: "รองานที่กำลังส่ง" } : null,
  ]);
}

export async function groupDispatchDelay(tx: Prisma.TransactionClient, area: string, cooldownSec: number, now: Date): Promise<DispatchDelay | null> {
  const previous = await tx.autoCommentLog.findFirst({ where: { event: "dispatch", pageId: area }, orderBy: { createdAt: "desc" }, include: { job: { include: { rule: true } } } });
  if (!previous) return null;
  const at = previous.createdAt.getTime() + Math.max(cooldownSec, previous.job?.rule.areaCooldownSec ?? 0) * 1000;
  return at > now.getTime() ? { retryAt: new Date(at), reason: "รอระยะพักของกลุ่ม" } : null;
}
