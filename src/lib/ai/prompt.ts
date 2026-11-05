import type { CatNode } from "../pipeline/catalog";
import type { ClassifyInput } from "../pipeline/classify-rules";
import { hintLabel } from "../pipeline/group-profile";

// Kept short on purpose: every token here is re-read by the local model for every batch.
export const AI_SYSTEM = `คัดแยกโพสต์ภาษาไทยจากกลุ่มซื้อขาย ตอบ JSON เท่านั้น:
{"items":[{"id":"","categorySlug":"","subcategorySlug":null,"intent":"buyer","province":null,"isAd":false,"urgency":0.5,"hasBudget":false,"specificity":0.5,"productSlug":null,"suggestedReply":""}]}
ตัวอย่าง:
- "หา iPad มือสอง" buyer, it; "รับทำเว็บ" seller, freelance
- "หารหัสหญิงล้วน งบ300" buyer, games/game-id; "ตัวแทนดันรหัส 265" seller, games/game-boost
- "โรแท้ เรท3.2" seller, games/game-topup; "หากลางเครดิต" buyer, games/game-middleman
- "มาคุยกันเรื่องเกม" chat, games; "#รหัสMS240685 ส่งฟรี" seller, food
- "ลิงก์ Shopee ชวนซื้อ" isAd true, ad
กติกา:
- slug จากรายการเท่านั้น ไม่มีย่อยใส่ null
- buyer=หา อยากได้ รับซื้อ; seller=ขาย พร้อมส่ง รับทำ; chat=พูดคุย ถามความเห็น รีวิว เตือนภัย; ไม่ชัดใช้ unknown
- รหัส/ไอดี/เติมเกม/ดันแรงค์ โร เรท เพ็ด ไอเทม ติดเวด = games; MS+ตัวเลข = รหัสร้าน
- group = หมวดหลักของกลุ่ม ใช้ตัดสินโพสต์สั้น (games "ไก่ตัน"=ของในเกม)
- province จังหวัดเต็มหรือ null; urgency/specificity 0-1; hasBudget=มีงบ/ราคา
- productSlug เกม/สินค้าจากรายการ หรือ null
- suggestedReply ไทยสุภาพ ≤150 ตัว ไม่มีลิงก์`;

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

/** Level-3 products/games the AI may pick from ("games: roblox,rov,…"); set by the queue from the DB. */
let productList = "";

export function setProductList(list: string) {
  productList = list.slice(0, 600);
}

export const PROMPT_TEXT_LIMIT = 800;

export function userPrompt(posts: ClassifyInput[], catalog: CatNode[]): string {
  const corrections = ownerExamples.length
    ? `\n\nเจ้าของเคยแก้หมวดแบบนี้:\n${ownerExamples.map((item) => `- "${item.text}" = ${item.label}`).join("\n")}`
    : "";
  const products = productList ? `\n\nproductSlug ที่ใช้ได้:\n${productList}` : "";
  return `หมวดที่ใช้ได้:\n${catalogPrompt(catalog)}${products}${corrections}\n\nโพสต์:\n${JSON.stringify(
    posts.map((post) => {
      const group = hintLabel(post.groupHint);
      return group ? { id: post.id, group, text: post.text.slice(0, PROMPT_TEXT_LIMIT) } : { id: post.id, text: post.text.slice(0, PROMPT_TEXT_LIMIT) };
    }),
  )}`;
}
