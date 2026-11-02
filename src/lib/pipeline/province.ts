export const PROVINCES = [
  "กรุงเทพมหานคร",
  "กระบี่",
  "กาญจนบุรี",
  "กาฬสินธุ์",
  "กำแพงเพชร",
  "ขอนแก่น",
  "จันทบุรี",
  "ฉะเชิงเทรา",
  "ชลบุรี",
  "ชัยนาท",
  "ชัยภูมิ",
  "ชุมพร",
  "เชียงราย",
  "เชียงใหม่",
  "ตรัง",
  "ตราด",
  "ตาก",
  "นครนายก",
  "นครปฐม",
  "นครพนม",
  "นครราชสีมา",
  "นครศรีธรรมราช",
  "นครสวรรค์",
  "นนทบุรี",
  "นราธิวาส",
  "น่าน",
  "บึงกาฬ",
  "บุรีรัมย์",
  "ปทุมธานี",
  "ประจวบคีรีขันธ์",
  "ปราจีนบุรี",
  "ปัตตานี",
  "พระนครศรีอยุธยา",
  "พะเยา",
  "พังงา",
  "พัทลุง",
  "พิจิตร",
  "พิษณุโลก",
  "เพชรบุรี",
  "เพชรบูรณ์",
  "แพร่",
  "ภูเก็ต",
  "มหาสารคาม",
  "มุกดาหาร",
  "แม่ฮ่องสอน",
  "ยโสธร",
  "ยะลา",
  "ร้อยเอ็ด",
  "ระนอง",
  "ระยอง",
  "ราชบุรี",
  "ลพบุรี",
  "ลำปาง",
  "ลำพูน",
  "เลย",
  "ศรีสะเกษ",
  "สกลนคร",
  "สงขลา",
  "สตูล",
  "สมุทรปราการ",
  "สมุทรสงคราม",
  "สมุทรสาคร",
  "สระแก้ว",
  "สระบุรี",
  "สิงห์บุรี",
  "สุโขทัย",
  "สุพรรณบุรี",
  "สุราษฎร์ธานี",
  "สุรินทร์",
  "หนองคาย",
  "หนองบัวลำภู",
  "อ่างทอง",
  "อำนาจเจริญ",
  "อุดรธานี",
  "อุตรดิตถ์",
  "อุทัยธานี",
  "อุบลราชธานี",
] as const;

const ALIASES: [RegExp, string][] = [
  [/กรุงเทพมหานคร|กรุงเทพฯ|กรุงเทพ|กทม\.?/u, "กรุงเทพมหานคร"],
  [/พระนครศรีอยุธยา|(?<![\p{L}\p{N}])อยุธยา(?![\p{L}\p{N}])/u, "พระนครศรีอยุธยา"],
  [/นครราชสีมา|(?<![\p{L}\p{N}])โคราช(?![\p{L}\p{N}])/u, "นครราชสีมา"],
];

const AMBIGUOUS = new Set(["เลย", "แพร่", "ตาก", "น่าน", "ตรัง", "ยะลา", "ระนอง", "สตูล"]);

export function normalizeProvinceName(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  if ((PROVINCES as readonly string[]).includes(text)) return text;
  for (const [pattern, canonical] of ALIASES) {
    if (pattern.test(text)) return canonical;
  }
  const found = (PROVINCES as readonly string[]).find((name) => text.includes(name));
  return found ?? null;
}

export function extractProvince(text: string): string | null {
  const hits: { index: number; name: string }[] = [];
  for (const [pattern, canonical] of ALIASES) {
    const match = pattern.exec(text);
    if (match) hits.push({ index: match.index, name: canonical });
  }
  const direct = [...PROVINCES].filter((name) => !AMBIGUOUS.has(name));
  for (const name of direct) {
    const index = text.indexOf(name);
    if (index >= 0) hits.push({ index, name });
  }
  for (const name of PROVINCES) {
    const prefixed = new RegExp(`(?:จังหวัด|จ\\.|จว\\.)\\s*${name}`);
    const match = prefixed.exec(text);
    if (match) hits.push({ index: match.index, name });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.index - b.index || b.name.length - a.name.length);
  return hits[0].name;
}
