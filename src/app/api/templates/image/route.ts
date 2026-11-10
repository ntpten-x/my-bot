import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  MESSAGE_IMAGE_MAX_BYTES,
  messageImageObjectPath,
  messageImageStorageConfigured,
  removeMessageImage,
  signedMessageImageUrl,
  uploadMessageImage,
  validateMessageImage,
} from "@/lib/supabase-storage";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { error } = await authed();
  if (error) return error;
  if (!messageImageStorageConfigured()) {
    return json({ error: "ยังไม่ได้ตั้งค่า Supabase Storage สำหรับรูปข้อความ" }, 503);
  }

  const contentType = request.headers.get("content-type") || "";
  let templateId = "";
  let mime = "";
  let bytes: Buffer | null = null;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: "อัปโหลดไม่สำเร็จ" }, 400);
    templateId = String(form.get("templateId") || "").trim();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "ต้องแนบไฟล์รูป" }, 400);
    mime = file.type || "";
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.byteLength > MESSAGE_IMAGE_MAX_BYTES) return json({ error: "รูปต้องมีขนาดไม่เกิน 2 MB" }, 400);
    bytes = buf;
  } else {
    const raw = await request.json().catch(() => null) as { templateId?: string; mime?: string; dataBase64?: string } | null;
    templateId = String(raw?.templateId || "").trim();
    mime = String(raw?.mime || "").trim();
    const encoded = String(raw?.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    if (!encoded) return json({ error: "ต้องแนบไฟล์รูป" }, 400);
    bytes = Buffer.from(encoded, "base64");
  }

  if (!templateId || !bytes) return json({ error: "ข้อมูลไม่ครบ" }, 400);
  const invalid = validateMessageImage({ mime, bytes: bytes.byteLength });
  if (invalid) return json({ error: invalid }, 400);

  const template = await prisma.replyTemplate.findUnique({ where: { id: templateId } });
  if (!template) return json({ error: "ไม่พบข้อความ" }, 404);

  const path = messageImageObjectPath(templateId, mime);
  try {
    await uploadMessageImage(path, bytes, mime);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "อัปโหลดรูปไม่สำเร็จ" }, 502);
  }

  const previous = template.imagePath;
  const updated = await prisma.replyTemplate.update({ where: { id: templateId }, data: { imagePath: path } });
  if (previous && previous !== path) await removeMessageImage(previous).catch(() => undefined);

  const imageUrl = await signedMessageImageUrl(path).catch(() => null);
  return json({ template: { ...updated, imageUrl } });
}
