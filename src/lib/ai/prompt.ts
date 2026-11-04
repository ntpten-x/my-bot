import type { CatNode } from "../pipeline/catalog";
import type { ClassifyInput } from "../pipeline/classify-rules";

// Kept short on purpose: every token here is re-read by the local model for every batch.
export const AI_SYSTEM = `คัดแยกโพสต์ภาษาไทยจากกลุ่มซื้อขาย ตอบ JSON เท่านั้น:
{"items":[{"id":"","categorySlug":"","subcategorySlug":null,"intent":"buyer","province":null,"isAd":false,"urgency":0.5,"hasBudget":false,"specificity":0.5,"suggestedReply":""}]}
ตัวอย่าง:
- "หา iPad มือสอง" buyer, it
- "พร้อมส่งไอโฟน" seller, it
- "รับทำเว็บ" seller, freelance
- "หารหัสหญิงล้วน งบ300" buyer, games/game-id
- "ตัวแทนดันรหัส 265 บาท" seller, games/game-boost
- "ขายของในเกม ไข่เยอะ พร้อมเล่น 99.-" seller, games/game-id
- "#รหัสMS240685 ส่งฟรี" seller, food
- "ยำลูกชิ้นพร้อมส่ง" seller, food
- "ลิงก์ Shopee Lazada ชวนซื้อ" isAd true, intent ad
กติกา:
- slug ต้องมาจากรายการเท่านั้น ไม่มีหมวดย่อยใส่ null
- buyer = หา ตามหา อยากได้ รับซื้อ พอรู้จัก มั้ย; seller = ขาย พร้อมส่ง รับทำ รับจ้าง; ถ้าเป็นแค่เล่าเรื่องหรือถามทั่วไป ใช้ unknown
- รหัสเกม ไอดี เติมเกม ดันแรงค์ ชื่อเกม = games; รหัส MS ตามด้วยตัวเลข = รหัสสินค้าร้าน (seller)
- province ชื่อจังหวัดเต็มหรือ null; urgency/specificity 0-1; hasBudget true ถ้ามีงบหรือราคา
- suggestedReply ภาษาไทยสุภาพ ไม่เกิน 150 ตัวอักษร ไม่มีลิงก์`;

/** Recent posts the owner re-labelled by hand; shown to the model as extra examples. */
let ownerExamples: { text: string; label: string }[] = [];

export function setOwnerExamples(list: { text: string; label: string }[]) {
  ownerExamples = list
    .filter((item) => item.text && item.label)
    .slice(0, 6)
    .map((item) => ({ text: item.text.replace(/\s+/g, " ").slice(0, 100), label: item.label }));
}

export function catalogPrompt(catalog: CatNode[]): string {
  return catalog
    .map((node) => {
      const parent = node.parentSlug ? ` (ย่อยของ ${node.parentSlug})` : "";
      return `- ${node.slug}${parent}: ${node.name}`;
    })
    .join("\n");
}

export const PROMPT_TEXT_LIMIT = 800;

export function userPrompt(posts: ClassifyInput[], catalog: CatNode[]): string {
  const corrections = ownerExamples.length
    ? `\n\nเจ้าของเคยแก้หมวดแบบนี้:\n${ownerExamples.map((item) => `- "${item.text}" = ${item.label}`).join("\n")}`
    : "";
  return `หมวดที่ใช้ได้:\n${catalogPrompt(catalog)}${corrections}\n\nโพสต์:\n${JSON.stringify(
    posts.map((post) => ({ id: post.id, text: post.text.slice(0, PROMPT_TEXT_LIMIT) })),
  )}`;
}
