import { afterEach, expect, it, vi } from "vitest";
import { allowedDiscordWebhook, sendDiscordContent, sendDiscordEmbed } from "../../src/lib/discord";
afterEach(() => vi.unstubAllGlobals());
it("rejects arbitrary webhook hosts and credentials without sending any traffic", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  for (const url of ["http://127.0.0.1/internal", "https://evil.example/api/webhooks/1/token", "https://discord.com.evil.example/api/webhooks/1/token", "https://user:password@discord.com/api/webhooks/1/token"]) {
    expect(allowedDiscordWebhook(url)).toBe(false);
    expect((await sendDiscordContent(url, "synthetic")).ok).toBe(false);
    expect((await sendDiscordEmbed(url, { title: "synthetic" })).ok).toBe(false);
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("sends only to a valid Discord webhook and refuses redirects", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 }); vi.stubGlobal("fetch", fetch);
  const url = "https://discord.com/api/webhooks/123456789/synthetic-token";
  expect((await sendDiscordContent(url, "synthetic")).ok).toBe(true);
  expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "error" }));
});
