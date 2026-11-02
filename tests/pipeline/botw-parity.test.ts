import { describe, expect, it } from "vitest";
import { extractContacts } from "../../src/lib/pipeline/contacts";
import { renderTemplate } from "../../src/lib/templates";
import { inServiceArea, parseProvinceList } from "../../src/lib/service-area";
import { followUpDate, matchRule, splitList } from "../../src/lib/automation";

const basePost = {
  text: "หาช่างล้างแอร์ 2 เครื่อง แถวบางใหญ่ด่วน",
  ocrText: "",
  categoryId: "cat-air",
  subcategoryId: "sub-clean",
  province: "นนทบุรี",
  intent: "buyer",
  score: 70,
  isAd: false,
  forbiddenHit: false,
  duplicateOfId: null,
};
const baseRule = { enabled: true, categoryId: null, keywords: "", provinces: "", intent: "", minScore: 0 };

describe("contact extraction", () => {
  it("finds Thai mobile numbers in common formats", () => {
    const contacts = extractContacts("โทร 081-234-5678 หรือ 0899999999 / +66 91 234 5678");
    expect(contacts.filter((item) => item.type === "phone").map((item) => item.href)).toEqual([
      "tel:0812345678", "tel:0899999999", "tel:0912345678",
    ]);
  });

  it("reads Thai digits and landlines", () => {
    const contacts = extractContacts("ติดต่อ ๐๘๑๒๓๔๕๖๗๘ หรือ 02-123-4567");
    expect(contacts.map((item) => item.href)).toEqual(["tel:0812345678", "tel:021234567"]);
  });

  it("finds LINE ids and links without mistaking phone numbers", () => {
    const contacts = extractContacts("แอดไลน์ @airfix ได้เลย หรือ line id: somchai_99 https://line.me/ti/p/abc line 0812345678");
    const lines = contacts.filter((item) => item.type === "line").map((item) => item.value);
    expect(lines).toContain("@airfix");
    expect(lines).toContain("somchai_99");
    expect(lines).toContain("line.me/ti/p/abc");
    expect(lines).not.toContain("0812345678");
  });

  it("ignores long numbers that are not phones", () => {
    expect(extractContacts("เลขพัสดุ 123408123456789 ราคา 15000 บาท")).toEqual([]);
  });
});

describe("reply templates", () => {
  it("fills Thai and English placeholders and leaves unknown ones", () => {
    const text = renderTemplate("สวัสดีครับคุณ{ชื่อ} รับงาน{หมวดย่อย} ใน{province} {อื่นๆ}", {
      author: "สมชาย", category: "แอร์", subcategory: "ล้างแอร์", province: "นนทบุรี",
    });
    expect(text).toBe("สวัสดีครับคุณสมชาย รับงานล้างแอร์ ในนนทบุรี {อื่นๆ}");
  });

  it("falls back to the category and tidies a missing name", () => {
    expect(renderTemplate("สวัสดีครับคุณ{ชื่อ} ครับ รับ{หมวดย่อย}", { category: "แอร์" })).toBe("สวัสดีครับคุณครับ รับแอร์");
  });
});

describe("service area", () => {
  it("normalizes province names and drops unknown text", () => {
    expect(parseProvinceList("กรุงเทพมหานคร, นนทบุรี,ไม่มีจังหวัดนี้, นนทบุรี")).toEqual(["กรุงเทพมหานคร", "นนทบุรี"]);
  });

  it("keeps posts without a province and with no area set", () => {
    expect(inServiceArea(null, ["นนทบุรี"])).toBe(true);
    expect(inServiceArea("เชียงใหม่", [])).toBe(true);
    expect(inServiceArea("เชียงใหม่", ["นนทบุรี"])).toBe(false);
    expect(inServiceArea("นนทบุรี", ["นนทบุรี"])).toBe(true);
  });
});

describe("automation rules", () => {
  it("matches on category, subcategory, intent, score, province and keywords", () => {
    expect(matchRule({ ...baseRule, categoryId: "cat-air" }, basePost)).toBe(true);
    expect(matchRule({ ...baseRule, categoryId: "sub-clean" }, basePost)).toBe(true);
    expect(matchRule({ ...baseRule, categoryId: "cat-other" }, basePost)).toBe(false);
    expect(matchRule({ ...baseRule, intent: "seller" }, basePost)).toBe(false);
    expect(matchRule({ ...baseRule, minScore: 80 }, basePost)).toBe(false);
    expect(matchRule({ ...baseRule, provinces: "กรุงเทพมหานคร, นนทบุรี" }, basePost)).toBe(true);
    expect(matchRule({ ...baseRule, provinces: "เชียงใหม่" }, basePost)).toBe(false);
    expect(matchRule({ ...baseRule, provinces: "นนทบุรี" }, { ...basePost, province: null })).toBe(false);
    expect(matchRule({ ...baseRule, keywords: "ซ่อมรถ, ล้างแอร์" }, basePost)).toBe(true);
    expect(matchRule({ ...baseRule, keywords: "ซ่อมรถ" }, basePost)).toBe(false);
  });

  it("matches keywords found only in OCR text", () => {
    expect(matchRule({ ...baseRule, keywords: "ติดตั้ง" }, { ...basePost, ocrText: "รับติดตั้งแอร์" })).toBe(true);
  });

  it("never fires on disabled rules, ads, forbidden or duplicate posts", () => {
    expect(matchRule({ ...baseRule, enabled: false }, basePost)).toBe(false);
    expect(matchRule(baseRule, { ...basePost, isAd: true })).toBe(false);
    expect(matchRule(baseRule, { ...basePost, forbiddenHit: true })).toBe(false);
    expect(matchRule(baseRule, { ...basePost, duplicateOfId: "first" })).toBe(false);
  });

  it("splits lists and computes follow-up dates", () => {
    expect(splitList(" a, b ,\nc|")).toEqual(["a", "b", "c"]);
    const from = new Date("2026-11-02T00:00:00Z");
    expect(followUpDate(2, from)?.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(followUpDate(0, from)).toBeNull();
  });
});
