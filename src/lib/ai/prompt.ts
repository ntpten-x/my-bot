import type { CatNode } from "../pipeline/catalog";
import type { ClassifyInput } from "../pipeline/classify-rules";

export const AI_SYSTEM = `คุณคือผู้ช่วยคัดแยกประกาศภาษาไทยจากกลุ่มซื้อขาย
ตอบเป็น JSON เท่านั้น ในรูปแบบ
{"items":[{"id":"","categorySlug":"","subcategorySlug":null,"intent":"buyer","province":null,"isAd":false,"urgency":0.5,"hasBudget":false,"specificity":0.5,"suggestedReply":""}]}
ตัวอย่าง:
- "พร้อมส่งไอโฟน" seller, it, isAd false
- "ขายการ์ดจอมือสอง" seller, it
- "รับทำเว็บ" seller, freelance
- "รับออกแบบโลโก้" seller, freelance
- "หา iPad มือสอง" buyer, it
- "ตามหาคนรับเติมเกม" buyer, games/game-topup
- "พอรู้จักร้านซ่อมไอแพดมั้ย" buyer, it
- "อยากได้ข้าวมันไก่ส่งบ้าน" buyer, food
- "ยำลูกชิ้นพร้อมส่ง" seller, food, isAd false
- "ลิงก์ Shopee Lazada Grab หรือ KFC ชวนซื้อ" isAd true, intent ad
กติกา:
- categorySlug และ subcategorySlug ต้องเลือกจากรายการที่ให้เท่านั้น ถ้าไม่มีหมวดย่อยให้ใส่ null
- ไอแพด ไอโฟน แท็บเล็ต มือถือ เป็นหมวด it
- อาหาร เครื่องดื่ม เป็น food บริการซ่อมหรือจ้างทั่วไปเป็น services การเดินทางทัวร์เป็น travel
- intent เป็น buyer เมื่อมี หา ตามหา พอรู้จัก มั้ย อยากได้ รับซื้อ และเป็น seller เมื่อมี ขาย พร้อมส่ง รับทำ รับออกแบบ รับจ้าง
- หลีกเลี่ยง unknown ถ้ามีคำซื้อขายชัดเจน
- province เป็นชื่อจังหวัดไทยแบบเต็ม หรือ null
- isAd เป็น true เมื่อเป็นโฆษณาร้าน ลิงก์พันธมิตร Shopee Lazada Grab KFC หรือสแปมขายส่ง และ intent เป็น ad
- ถ้ามี พร้อมส่ง ขาย รับทำ รับออกแบบ โดยไม่มี หา ตามหา อยากได้ ให้ intent เป็น seller
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
