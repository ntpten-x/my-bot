import { PROVIDER_PRESETS, PROVIDER_TASKS, presetById } from "./provider-presets";
import { encryptSecret, hasKeySecret, maskSecret } from "./secret-box";

type Body = Record<string, unknown>;

function intOrNull(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > max) throw new Error("ตัวเลขขีดจำกัดไม่ถูกต้อง");
  return n;
}

/** Validates create/update input. `partial` means only the fields present are changed. */
export function providerData(body: Body, partial: boolean) {
  const data: Record<string, unknown> = {};
  const has = (key: string) => body[key] !== undefined;
  if (!partial || has("preset")) {
    const preset = String(body.preset ?? "custom");
    if (!PROVIDER_PRESETS.some((item) => item.id === preset)) throw new Error("ไม่รู้จักชนิดผู้ให้บริการ");
    data.preset = preset;
    data.kind = presetById(preset).kind;
  }
  if (!partial || has("name")) {
    const name = String(body.name ?? "").trim();
    if (!name || name.length > 60) throw new Error("ใส่ชื่อ 1-60 ตัวอักษร");
    data.name = name;
  }
  if (!partial || has("baseUrl")) {
    const baseUrl = String(body.baseUrl ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) throw new Error("Base URL ต้องขึ้นต้นด้วย http:// หรือ https://");
    data.baseUrl = baseUrl;
  }
  if (!partial || has("model")) {
    const model = String(body.model ?? "").trim();
    if (model.length > 200) throw new Error("ชื่อโมเดลยาวเกินไป");
    data.model = model;
  }
  if (has("enabled")) data.enabled = Boolean(body.enabled);
  if (has("tasks")) {
    const tasks = (Array.isArray(body.tasks) ? body.tasks : []).map(String).filter((task) => PROVIDER_TASKS.some((item) => item.value === task));
    data.tasks = [...new Set(tasks)].join(",");
  }
  if (has("limitPerMinute")) data.limitPerMinute = intOrNull(body.limitPerMinute, 10_000);
  if (has("limitPerDay")) data.limitPerDay = intOrNull(body.limitPerDay, 10_000_000);
  if (has("resetHourUtc")) {
    const hour = Math.floor(Number(body.resetHourUtc));
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) throw new Error("ชั่วโมงรีเซ็ตต้องเป็น 0-23");
    data.resetHourUtc = hour;
  }
  if (body.clearKey === true) {
    data.apiKeyEnc = null;
    data.apiKeyHint = null;
  } else if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    const key = body.apiKey.trim();
    if (!hasKeySecret()) throw new Error("ยังไม่ได้ตั้ง AI_KEY_SECRET ใน .env จึงยังเก็บคีย์ไม่ได้");
    if (key.length > 500) throw new Error("API key ยาวเกินไป");
    data.apiKeyEnc = encryptSecret(key);
    data.apiKeyHint = maskSecret(key);
  }
  return data;
}