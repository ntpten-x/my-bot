import { createHash } from "crypto";
import { prisma } from "./prisma";
import type { AppSettings } from "./settings";

const MAX_BYTES = 2_000_000;
const MAX_IMAGES = 3;

export function imageHash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function downloadImage(url: string): Promise<Buffer | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  const length = Number(response.headers.get("content-length") || "0");
  if (length > MAX_BYTES) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  return bytes;
}

async function readWithVision(bytes: Buffer, settings: AppSettings): Promise<string | null> {
  if (!settings.visionOcr) return null;
  try {
    const tags = await fetch(`${settings.ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!tags.ok) return null;
    const data = await tags.json();
    const names: string[] = (data.models ?? []).map((model: { name?: string }) => model.name ?? "");
    const model = names.find((name) => /qwen2\.5vl|llava/i.test(name));
    if (!model) return null;
    const response = await fetch(`${settings.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: "user",
            content: "อ่านข้อความในรูปนี้ ทั้งไทยและอังกฤษ ตอบเฉพาะข้อความที่เห็น",
            images: [bytes.toString("base64")],
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const body = await response.json();
    const text = String(body.message?.content ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}

async function readWithTesseract(bytes: Buffer): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("tha+eng");
  try {
    const result = await worker.recognize(bytes);
    return String(result.data.text ?? "").replace(/\s+/g, " ").trim();
  } finally {
    await worker.terminate();
  }
}

export async function ocrImage(url: string, settings: AppSettings): Promise<string> {
  const bytes = await downloadImage(url);
  if (!bytes) return "";
  const hash = imageHash(bytes);
  const cached = await prisma.ocrCache.findUnique({ where: { imageHash: hash } });
  if (cached) return cached.text;
  const vision = await readWithVision(bytes, settings);
  const text = vision || (await readWithTesseract(bytes).catch(() => ""));
  const provider = vision ? "ollama-vision" : text ? "tesseract" : "empty";
  if (text) {
    await prisma.ocrCache.upsert({
      where: { imageHash: hash },
      update: { text, provider },
      create: { imageHash: hash, text, provider },
    });
  }
  return text;
}

export async function ocrPostImages(imageUrls: string[], settings: AppSettings) {
  if (!settings.ocrEnabled) return "";
  const parts: string[] = [];
  for (const url of imageUrls.slice(0, MAX_IMAGES)) {
    const text = await ocrImage(url, settings).catch(() => "");
    if (text) parts.push(text);
  }
  return parts.join("\n").slice(0, 2000);
}
