// Pull contact channels out of a public post so the owner can reach the poster
// directly (tap-to-call / open LINE). Read-only: nothing is sent anywhere.
export type Contact = { type: "phone" | "line" | "link"; value: string; href: string };

const THAI_DIGITS: Record<string, string> = { "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4", "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9" };

function toArabic(text: string) {
  return text.replace(/[๐-๙]/g, (digit) => THAI_DIGITS[digit] ?? digit);
}

export function extractContacts(input: string, limit = 6): Contact[] {
  const text = toArabic(input || "");
  const out: Contact[] = [];
  const seen = new Set<string>();
  const push = (contact: Contact) => {
    const key = `${contact.type}:${contact.value.toLowerCase()}`;
    if (seen.has(key) || out.length >= limit) return;
    seen.add(key);
    out.push(contact);
  };

  // Thai phone numbers: mobile 06/08/09 + 8 digits, landline 02-07 + 7 digits, with optional separators or +66.
  const phoneRe = /(?:\+?66[\s.-]?|0)(?:[689](?:[\s.-]?\d){8}|[2-7](?:[\s.-]?\d){7})(?!\d)/g;
  for (const match of text.matchAll(phoneRe)) {
    const before = match.index ? text[match.index - 1] : "";
    if (before && /\d/.test(before)) continue;
    let digits = match[0].replace(/\D/g, "");
    if (digits.startsWith("66")) digits = `0${digits.slice(2)}`;
    if (digits.length < 9 || digits.length > 10) continue;
    const pretty = digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    push({ type: "phone", value: pretty, href: `tel:${digits}` });
  }

  for (const match of text.matchAll(/https?:\/\/(?:line\.me|lin\.ee)\/[^\s)]+/gi)) {
    push({ type: "line", value: match[0].replace(/^https?:\/\//, ""), href: match[0] });
  }

  // "line id: abc", "ไลน์ @shop", "ID line : abc", "แอดไลน์ abc"
  const lineRe = /(?:line\s*(?:id)?|id\s*line|ไลน์(?:\s*ไอดี)?|ไอดีไลน์|แอดไลน์|ไอดี\s*line)\s*[:：=]?\s*(@?[a-z0-9][a-z0-9._-]{2,30})/gi;
  for (const match of text.matchAll(lineRe)) {
    const id = match[1].replace(/[._-]+$/, "");
    if (/^\d{9,10}$/.test(id)) continue; // a phone number written after "line"
    if (/^(id|me|line)$/i.test(id)) continue;
    const href = id.startsWith("@")
      ? `https://line.me/R/ti/p/${encodeURIComponent(id)}`
      : `https://line.me/ti/p/~${encodeURIComponent(id)}`;
    push({ type: "line", value: id, href });
  }

  for (const match of text.matchAll(/https?:\/\/(?:m\.me|(?:www\.)?messenger\.com)\/[^\s)]+/gi)) {
    push({ type: "link", value: match[0].replace(/^https?:\/\//, ""), href: match[0] });
  }
  return out;
}
