// Facebook post-time parser (read-only helper). Turns Thai/English relative or absolute
// timestamps ("3 ชม.", "เมื่อวานนี้ เวลา 14:20", "2 พฤศจิกายน เวลา 10:00", "3h", "Yesterday at 2:20 PM")
// into an absolute ISO time, interpreting wall-clock times in Asia/Bangkok (UTC+7, no DST).
(function (root) {
  const OFFSET = 7 * 3600 * 1000;
  const DAY = 86400 * 1000;
  const TH_MONTHS = [
    ["มกราคม", "ม.ค."], ["กุมภาพันธ์", "ก.พ."], ["มีนาคม", "มี.ค."], ["เมษายน", "เม.ย."],
    ["พฤษภาคม", "พ.ค."], ["มิถุนายน", "มิ.ย."], ["กรกฎาคม", "ก.ค."], ["สิงหาคม", "ส.ค."],
    ["กันยายน", "ก.ย."], ["ตุลาคม", "ต.ค."], ["พฤศจิกายน", "พ.ย."], ["ธันวาคม", "ธ.ค."],
  ];
  const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const UNITS = [
    [/^(?:วินาที|วิ\.?|seconds?|secs?|s)$/, 1000],
    [/^(?:นาที|น\.|minutes?|mins?|m)$/, 60 * 1000],
    [/^(?:ชั่วโมง|ชม\.?|hours?|hrs?|h)$/, 3600 * 1000],
    [/^(?:วัน|days?|d)$/, DAY],
    [/^(?:สัปดาห์|สป\.|weeks?|wks?|w)$/, 7 * DAY],
  ];

  function bangkokParts(ms) {
    const d = new Date(ms + OFFSET);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
  }

  function wallClock(y, m, d, h, mi) {
    return Date.UTC(y, m, d, h, mi) - OFFSET;
  }

  function parseClock(text) {
    const match = String(text || "").trim().match(/^(\d{1,2})[:.](\d{2})\s*(am|pm|น\.)?$/i);
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const half = (match[3] || "").toLowerCase();
    if (half === "pm" && hour < 12) hour += 12;
    if (half === "am" && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }

  function monthIndex(word) {
    const value = String(word || "").toLowerCase().replace(/\s/g, "");
    for (let i = 0; i < 12; i++) {
      const [full, abbr] = TH_MONTHS[i];
      if (value === full || value === abbr || value === abbr.replace(/\./g, "")) return i;
    }
    if (/^[a-z]+\.?$/.test(value)) {
      const base = value.replace(/\.$/, "");
      for (let i = 0; i < 12; i++) if (base.length >= 3 && (base.startsWith(EN_MONTHS[i]) || EN_MONTHS[i] === base)) return i;
    }
    return -1;
  }

  function iso(ms) {
    return new Date(ms).toISOString();
  }

  function withClock(parts, rest) {
    let clock = null;
    if (rest && rest.trim()) {
      clock = parseClock(rest.replace(/^(?:เวลา|at)\s*/i, ""));
      if (!clock) return null;
    }
    const at = wallClock(parts.y, parts.m, parts.d, clock ? clock.hour : 12, clock ? clock.minute : 0);
    return { at, clock };
  }

  function parseFbTime(input, nowMs) {
    const now = typeof nowMs === "number" ? nowMs : Date.now();
    let text = String(input || "").replace(/[\u200B-\u200D\uFEFF]/g, "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 80) return null;
    text = text.replace(/^(?:โพสต์เมื่อ|posted)\s*/i, "").replace(/\s*·.*$/, "").trim();
    const low = text.toLowerCase();

    if (/^(?:เมื่อสักครู่|เมื่อกี้|เมื่อกี๊|ตอนนี้|ขณะนี้|just now|now)$/.test(low)) return iso(now);

    const rel = low.match(/^(\d+|an?|หนึ่ง)\s*([^\s\d]+?)(?:\s*(?:ที่แล้ว|ที่ผ่านมา|ago))?$/);
    if (rel) {
      const unit = UNITS.find(([pattern]) => pattern.test(rel[2]));
      if (unit) {
        const count = /^\d+$/.test(rel[1]) ? Number(rel[1]) : 1;
        if (count > 0 && count < 1000) return iso(now - count * unit[1]);
        return null;
      }
    }

    const dayWord = low.match(/^(เมื่อวาน(?:นี้)?|yesterday|วันนี้|today)(?:\s+(.*))?$/);
    if (dayWord) {
      const back = /^(?:วันนี้|today)$/.test(dayWord[1]) ? 0 : DAY;
      const result = withClock(bangkokParts(now - back), dayWord[2], now);
      if (!result) return null;
      return result.at > now + 3600 * 1000 ? null : iso(result.at);
    }

    let day = 0;
    let month = -1;
    let year = null;
    let rest = "";
    let match = text.match(/^(\d{1,2})\s+([^\s\d,]+)\s*,?\s*(\d{4})?\s*(.*)$/);
    if (match) {
      day = Number(match[1]);
      month = monthIndex(match[2]);
      year = match[3] ? Number(match[3]) : null;
      rest = match[4];
    } else {
      match = text.match(/^([A-Za-z]+\.?)\s+(\d{1,2})(?:,?\s*(\d{4}))?\s*(.*)$/);
      if (match) {
        month = monthIndex(match[1]);
        day = Number(match[2]);
        year = match[3] ? Number(match[3]) : null;
        rest = match[4];
      }
    }
    if (!match || month < 0 || day < 1 || day > 31) return null;
    if (year && year > 2400) year -= 543; // Buddhist Era
    const nowParts = bangkokParts(now);
    let result = withClock({ y: year || nowParts.y, m: month, d: day }, rest, now);
    if (!result) return null;
    if (!year && result.at > now + DAY) result = withClock({ y: nowParts.y - 1, m: month, d: day }, rest, now);
    if (!result || result.at > now + 3600 * 1000) return null;
    return iso(result.at);
  }

  const api = { parseFbTime };
  root.MyBotFbTime = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
