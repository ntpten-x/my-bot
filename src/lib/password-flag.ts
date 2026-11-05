import { prisma } from "./prisma";

const KEY = "security_password_weak";

export async function setPasswordWeak(weak: boolean) {
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: String(weak) }, update: { value: String(weak) } }).catch(() => undefined);
}

export async function isPasswordWeakFlagged() {
  const row = await prisma.setting.findUnique({ where: { key: KEY } }).catch(() => null);
  return row?.value === "true";
}