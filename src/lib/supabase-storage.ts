import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const MESSAGE_IMAGE_BUCKET = "message-images";
export const MESSAGE_IMAGE_MAX_BYTES = Math.floor(2.5 * 1024 * 1024);
export const MESSAGE_IMAGE_MAX_LABEL = "2.5 MB";
export const MESSAGE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
}

function serviceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}

export function messageImageStorageConfigured() {
  return Boolean(supabaseUrl() && serviceRoleKey());
}

function adminClient(): SupabaseClient {
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) throw new Error("ยังไม่ได้ตั้งค่า SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY สำหรับเก็บรูปข้อความ");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function ensureMessageImageBucket() {
  const client = adminClient();
  const listed = await client.storage.listBuckets();
  if (listed.error) throw new Error(listed.error.message);
  const options = {
    public: false,
    fileSizeLimit: MESSAGE_IMAGE_MAX_BYTES,
    allowedMimeTypes: [...MESSAGE_IMAGE_TYPES],
  };
  if (listed.data?.some(bucket => bucket.name === MESSAGE_IMAGE_BUCKET)) {
    // Keep an already-created private bucket, but raise the size limit when we change it.
    const updated = await client.storage.updateBucket(MESSAGE_IMAGE_BUCKET, options);
    if (updated.error && !/not allowed|policy|permission/i.test(updated.error.message)) {
      throw new Error(updated.error.message);
    }
    return;
  }
  const created = await client.storage.createBucket(MESSAGE_IMAGE_BUCKET, options);
  if (created.error && !/already exists|duplicate/i.test(created.error.message)) throw new Error(created.error.message);
}

export function validateMessageImage(input: { mime: string; bytes: number }) {
  if (!MESSAGE_IMAGE_TYPES.has(input.mime)) return "รองรับเฉพาะ JPEG, PNG หรือ WebP";
  if (input.bytes <= 0 || input.bytes > MESSAGE_IMAGE_MAX_BYTES) {
    return `รูปต้องมีขนาดไม่เกิน ${MESSAGE_IMAGE_MAX_LABEL}`;
  }
  return null;
}

export function messageImageObjectPath(templateId: string, mime: string) {
  const ext = EXT_BY_TYPE[mime] || "bin";
  return `templates/${templateId}/${randomUUID()}.${ext}`;
}

export async function uploadMessageImage(path: string, body: Buffer, mime: string) {
  await ensureMessageImageBucket();
  const client = adminClient();
  const result = await client.storage.from(MESSAGE_IMAGE_BUCKET).upload(path, body, {
    contentType: mime,
    upsert: false,
  });
  if (result.error) throw new Error(result.error.message);
  return path;
}

export async function removeMessageImage(path?: string | null) {
  const key = String(path || "").trim();
  if (!key) return;
  if (!messageImageStorageConfigured()) return;
  const client = adminClient();
  await client.storage.from(MESSAGE_IMAGE_BUCKET).remove([key]);
}

export async function signedMessageImageUrl(path?: string | null, expiresIn = 3600) {
  const key = String(path || "").trim();
  if (!key) return null;
  if (!messageImageStorageConfigured()) return null;
  const client = adminClient();
  const result = await client.storage.from(MESSAGE_IMAGE_BUCKET).createSignedUrl(key, expiresIn);
  if (result.error) throw new Error(result.error.message);
  return result.data.signedUrl;
}

export async function withMessageImageUrls<T extends { imagePath?: string | null }>(rows: T[], expiresIn = 3600) {
  return Promise.all(rows.map(async row => ({
    ...row,
    imageUrl: await signedMessageImageUrl(row.imagePath, expiresIn).catch(() => null),
  })));
}
