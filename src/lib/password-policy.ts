// Strong-password rules for setting/changing the owner password (Thai messages).
const COMMON = new Set([
  "password", "password1", "12345678", "123456789", "1234567890", "qwerty123", "11111111", "00000000",
  "admin1234", "iloveyou", "abc12345", "mybot123", "password123", "qwertyuiop", "88888888",
]);

export const MIN_PASSWORD_LENGTH = 12;

export function passwordProblems(password: string): string[] {
  const value = String(password ?? "");
  const problems: string[] = [];
  if (new TextEncoder().encode(value).byteLength > 72) problems.push("มีขนาด UTF-8 ไม่เกิน 72 bytes (ข้อจำกัด bcrypt)");
  if (value.length < MIN_PASSWORD_LENGTH) problems.push(`ยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัว`);
  if (!/[A-Za-z\u0E00-\u0E7F]/.test(value)) problems.push("มีตัวอักษร");
  if (!/\d/.test(value)) problems.push("มีตัวเลข");
  if (!/[^A-Za-z0-9]/.test(value) && !/[A-Z]/.test(value)) problems.push("มีตัวพิมพ์ใหญ่หรือสัญลักษณ์");
  if (COMMON.has(value.toLowerCase())) problems.push("ไม่ใช่รหัสที่คนใช้บ่อย");
  if (/^(.)\1+$/.test(value)) problems.push("ไม่ใช่ตัวเดียวซ้ำกัน");
  return problems;
}

export function isWeakPassword(password: string) {
  return passwordProblems(password).length > 0;
}