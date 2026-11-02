import type { CatNode } from "../pipeline/catalog";
import type { ClassifyInput } from "../pipeline/classify-rules";

export const AI_SYSTEM = `คุณคือผู้ช่วยคัดแยกประกาศภาษาไทยจากกลุ่มซื้อขาย
ตอบเป็น JSON เท่านั้น ในรูปแบบ
{"items":[{"id":"","categorySlug":"","subcategorySlug":null,"intent":"buyer","province":null,"isAd":false,"urgency":0.5,"hasBudget":false,"specificity":0.5,"suggestedReply":""}]}
กติกา:
- categorySlug และ subcategorySlug ต้องเลือกจากรายการที่ให้เท่านั้น ถ้าไม่มีหมวดย่อยให้ใส่ null
- intent เป็น buyer เมื่อคนกำลังหาหรือรับซื้อ, seller เมื่อคนกำลังขายหรือเสนอรับจ้าง, unknown เมื่อไม่ชัด
- province เป็นชื่อจังหวัดไทยแบบเต็ม หรือ null
- isAd เป็น true เมื่อเป็นโฆษณาร้าน สแปมขายส่ง หรือประกาศโปรโมชั่น
- urgency เป็น 0 ถึง 1 ตามความเร่งด่วน, hasBudget เป็น true ถ้ามีงบหรือราคา, specificity เป็น 0 ถึง 1 ตามความชัดของสินค้า
- suggestedReply เป็นประโยคภาษาไทยสุภาพสั้น ๆ ให้เจ้าของระบบก๊อปไปตอบเอง ห้ามใส่ลิงก์และห้ามเกิน 280 ตัวอักษร`;

export function catalogPrompt(catalog: CatNode[]): string {
  return catalog
    .map((node) => {
      const parent = node.parentSlug ? ` (ย่อยของ ${node.parentSlug})` : "";
      return `- ${node.slug}${parent}: ${node.name}`;
    })
    .join("\n");
}

export function userPrompt(posts: ClassifyInput[], catalog: CatNode[]): string {
  return `หมวดที่ใช้ได้:\n${catalogPrompt(catalog)}\n\nโพสต์:\n${JSON.stringify(
    posts.map((post) => ({ id: post.id, text: post.text.slice(0, 1200) })),
  )}`;
}
