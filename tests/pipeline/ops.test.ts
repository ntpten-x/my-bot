import { describe, expect, it } from "vitest";
import { pickGroqModel, groqAvailability, DEFAULT_GROQ_MODEL } from "../../src/lib/ai/models";
import { backoffMs, resetTokenBuckets, takeToken } from "../../src/lib/ai/bucket";
import { backupsToDelete } from "../../src/lib/backup";
import { buildLeadEmbed, buildSummaryEmbed, discordRetryDelayMs, scoreColor } from "../../src/lib/discord";

describe("groq model fallback", () => {
  it("keeps the owner's default and picks it from the account list", () => {
    const available = ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"];
    expect(DEFAULT_GROQ_MODEL).toBe("openai/gpt-oss-120b");
    expect(pickGroqModel("openai/gpt-oss-120b", available)).toBe("openai/gpt-oss-120b");
  });

  it("switches when the requested model is missing", () => {
    const available = ["openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
    const decision = groqAvailability("llama-3.3-70b-versatile", available, true);
    expect(decision.ok).toBe(true);
    expect(decision.model).toBe("openai/gpt-oss-20b");
    expect(decision.message).toContain("openai/gpt-oss-20b");
  });
});

describe("rate limit and backups", () => {
  it("refills a token bucket and reports how long to wait", () => {
    resetTokenBuckets();
    const first = takeToken("groq", 1_000);
    expect(first.ok).toBe(true);
    expect(backoffMs(0, 2)).toBe(2000);
    expect(backoffMs(3)).toBe(40_000);
  });

  it("drops backup files older than 14 days", () => {
    const now = Date.parse("2026-11-16T00:00:00Z");
    const old = Date.parse("2026-11-01T00:00:00Z");
    const recent = Date.parse("2026-11-10T00:00:00Z");
    expect(
      backupsToDelete(
        [
          { name: "2026-11-01.db", mtimeMs: old },
          { name: "2026-11-10.db", mtimeMs: recent },
          { name: "notes.txt", mtimeMs: old },
        ],
        now,
      ),
    ).toEqual(["2026-11-01.db"]);
  });
});

describe("discord embeds", () => {
  it("builds a hot lead embed with the reply in a code block", () => {
    const embed = buildLeadEmbed({
      title: "ลีดร้อน",
      text: "หาคนรับเติมเพชร",
      url: "https://www.facebook.com/groups/1/posts/2",
      score: 88,
      category: "เกม / เติมเกม",
      province: "เชียงใหม่",
      intent: "buyer",
      group: "กลุ่มทดสอบ",
      reply: "สวัสดีครับ",
    });
    expect(embed.color).toBe(scoreColor(88));
    expect(embed.fields?.find((field) => field.name === "คำตอบแนะนำ")?.value).toContain("```");
    expect(embed.fields?.find((field) => field.name === "จังหวัด")?.value).toBe("เชียงใหม่");
    expect(buildSummaryEmbed("สรุป", "ลีดเมื่อวาน 3 รายการ").title).toBe("สรุป");
  });

  it("reads Discord retry_after", () => {
    expect(discordRetryDelayMs(JSON.stringify({ retry_after: 1.5 }), 0)).toBe(1500);
  });
});
