import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { encodeSetting, decodeSetting, legacySecret } from "../../src/lib/setting-secrets";
beforeEach(() => vi.stubEnv("AI_KEY_SECRET", "synthetic-test-encryption-secret-only"));
afterEach(() => vi.unstubAllEnvs());
it.each(["groq_api_key", "gemini_api_key", "smtp_pass", "line_token", "discord_webhook", "extension_token"])("encrypts %s and reads legacy values without printing them", key => {
  const value = "synthetic-sensitive-value", encrypted = encodeSetting(key, value);
  expect(encrypted).not.toContain(value); expect(decodeSetting(key, encrypted)).toBe(value); expect(decodeSetting(key, value)).toBe(value);
  expect(legacySecret(key, value)).toBe(true); expect(legacySecret(key, encrypted)).toBe(false);
});
it("preserves ordinary values, supports clearing, and fails closed with a wrong master key", () => {
  expect(encodeSetting("scroll_screens", "3")).toBe("3"); expect(encodeSetting("groq_api_key", "")).toBe("");
  const encrypted = encodeSetting("groq_api_key", "synthetic-sensitive-value"); vi.stubEnv("AI_KEY_SECRET", "synthetic-different-encryption-secret");
  expect(() => decodeSetting("groq_api_key", encrypted)).toThrow();
});
