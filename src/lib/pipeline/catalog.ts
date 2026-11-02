export type CatNode = {
  slug: string;
  name: string;
  parentSlug: string | null;
  keywords: string[];
};

export type SeedCategory = {
  slug: string;
  name: string;
  keywords: string[];
  children?: { slug: string; name: string; keywords: string[] }[];
};

export const CATEGORY_SEEDS: SeedCategory[] = [
  {
    slug: "games",
    name: "เกม",
    keywords: ["เกม", "rov", "freefire", "ฟีฟาย", "pubg", "roblox", "โรบล็อก", "valorant"],
    children: [
      {
        slug: "game-topup",
        name: "เติมเกม",
        keywords: ["เติมเกม", "โรบัค", "เติมเพชร", "เพชรเกม", "คูปองเกม", "uc", "โทเคนเกม"],
      },
      {
        slug: "game-id",
        name: "ไอดีเกม",
        keywords: ["ไอดีเกม", "ขายไอดี", "บัญชีเกม", "id เกม", "ไอดีฟีฟาย"],
      },
      {
        slug: "game-boost",
        name: "รับจ้างเล่น",
        keywords: ["รับจ้างเล่น", "ไต่แรงค์", "บูสต์แรงค์", "รับจ้างแรงค์", "เก็บเลเวล", "รับไต่แรงค์"],
      },
    ],
  },
  {
    slug: "household",
    name: "ของใช้",
    keywords: ["ของใช้ในบ้าน", "เฟอร์นิเจอร์", "เครื่องครัว", "โซฟา", "ที่นอน", "ตู้เย็น", "เครื่องซักผ้า"],
  },
  {
    slug: "it",
    name: "อุปกรณ์ไอที",
    keywords: ["การ์ดจอ", "โน๊ตบุ๊ค", "โน้ตบุ๊ก", "คอมพิวเตอร์", "ไอโฟน", "iphone", "ipad", "ไอแพด", "แท็บเล็ต", "tablet", "samsung", "แรม", "ssd", "จอคอม", "มือถือ", "โทรศัพท์"],
  },
  {
    slug: "vehicle",
    name: "รถ",
    keywords: ["รถยนต์", "มอไซค์", "มอเตอร์ไซค์", "รถกระบะ", "รถบ้าน", "ขายรถ", "รถมือสอง"],
  },
  {
    slug: "freelance",
    name: "ฟรีแลนซ์",
    keywords: ["ฟรีแลนซ์", "รับออกแบบ", "รับตัดต่อ", "รับทำเว็บ", "รับเขียนโปรแกรม", "freelance"],
  },
  {
    slug: "property",
    name: "อสังหา",
    keywords: ["คอนโด", "ที่ดิน", "ขายบ้าน", "เช่าบ้าน", "ทาวน์โฮม", "อสังหาริมทรัพย์", "ห้องเช่า"],
  },
  {
    slug: "food",
    name: "อาหาร",
    keywords: ["อาหาร", "ก๋วยเตี๋ยว", "ข้าวมันไก่", "คาเฟ่", "กาแฟ", "ขนม", "เครื่องดื่ม", "ร้านอาหาร", "สั่งอาหาร", "ของกิน"],
  },
  {
    slug: "services",
    name: "บริการ",
    keywords: ["ล้างแอร์", "แม่บ้าน", "รับซ่อม", "ทำความสะอาด", "ช่างแอร์", "บริการ", "ช่างประปา", "รับจ้างทำความสะอาด"],
  },
  {
    slug: "travel",
    name: "เดินทาง",
    keywords: ["ตั๋วเครื่องบิน", "ทัวร์", "เดินทาง", "รับส่งสนามบิน", "รถตู้", "ที่พัก", "ตั๋วรถ", "สนามบิน"],
  },
  {
    slug: "other",
    name: "อื่นๆ",
    keywords: [],
  },
];

export const WATCH_KEYWORDS = ["รับซื้อ", "หาซื้อ", "ต้องการ", "ตามหา", "อยากได้", "มองหา"];
export const FORBIDDEN_KEYWORDS = ["พนัน", "เงินกู้นอกระบบ", "ยาเสพติด", "สแกม"];

export function flattenSeeds(seeds: SeedCategory[] = CATEGORY_SEEDS): CatNode[] {
  const out: CatNode[] = [];
  for (const category of seeds) {
    out.push({
      slug: category.slug,
      name: category.name,
      parentSlug: null,
      keywords: category.keywords,
    });
    for (const child of category.children ?? []) {
      out.push({
        slug: child.slug,
        name: child.name,
        parentSlug: category.slug,
        keywords: child.keywords,
      });
    }
  }
  return out;
}

export function catalogVersion(catalog: CatNode[]): string {
  return catalog.map((item) => `${item.slug}:${item.parentSlug ?? ""}:${item.keywords.join("+")}`).join("|");
}
