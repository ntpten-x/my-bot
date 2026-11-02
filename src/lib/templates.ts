export type TemplateContext = {
  category?: string | null;
  subcategory?: string | null;
  province?: string | null;
  author?: string | null;
  source?: string | null;
};

// Placeholders work in Thai or English: {หมวด} {category} {หมวดย่อย} {จังหวัด} {province} {ชื่อ} {author} {กลุ่ม} {group}
export const TEMPLATE_VARIABLES = ["{ชื่อ}", "{หมวด}", "{หมวดย่อย}", "{จังหวัด}", "{กลุ่ม}"] as const;

export function renderTemplate(body: string, context: TemplateContext) {
  const values: Record<string, string> = {
    "หมวด": context.category || "",
    category: context.category || "",
    "หมวดย่อย": context.subcategory || context.category || "",
    subcategory: context.subcategory || context.category || "",
    "จังหวัด": context.province || "",
    province: context.province || "",
    "ชื่อ": context.author || "",
    author: context.author || "",
    "กลุ่ม": context.source || "",
    group: context.source || "",
  };
  return body
    .replace(/\{([^{}\s]{1,20})\}/g, (whole, key: string) => (key in values ? values[key] : whole))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/คุณ\s+(?=[,，。.!?]|ครับ|ค่ะ|$)/g, "คุณ")
    .trim();
}
