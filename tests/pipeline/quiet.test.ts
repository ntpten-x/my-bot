import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Quiet = require("../../extension/quiet.js");

describe("extension quiet window", () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m);
  it("matches a same-day range", () => {
    expect(Quiet.inQuietWindow("19:00-23:00", at(20))).toBe(true);
    expect(Quiet.inQuietWindow("19:00-23:00", at(23))).toBe(false);
    expect(Quiet.inQuietWindow("19:00-23:00", at(18, 59))).toBe(false);
  });
  it("matches a range across midnight and multiple ranges", () => {
    expect(Quiet.inQuietWindow("22:00-02:00", at(1))).toBe(true);
    expect(Quiet.inQuietWindow("22:00-02:00", at(12))).toBe(false);
    expect(Quiet.inQuietWindow("08:00-09:00, 20:00-21:00", at(20, 30))).toBe(true);
  });
  it("ignores empty or invalid specs", () => {
    expect(Quiet.inQuietWindow("", at(20))).toBe(false);
    expect(Quiet.inQuietWindow("abc", at(20))).toBe(false);
  });
});

describe("pauseOnFacebook vs scrape-host tabs", () => {
  it("treats group and Marketplace browse URLs as scrape hosts", () => {
    expect(Quiet.isScrapeHostFacebookUrl("https://www.facebook.com/groups/Nexups")).toBe(true);
    expect(Quiet.isScrapeHostFacebookUrl("https://www.facebook.com/groups/1/posts/2")).toBe(true);
    expect(Quiet.isScrapeHostFacebookUrl("https://www.facebook.com/marketplace/bangkok/search?query=iphone")).toBe(true);
    expect(Quiet.isScrapeHostFacebookUrl("https://www.facebook.com/marketplace/item/123")).toBe(false);
    expect(Quiet.isScrapeHostFacebookUrl("https://www.facebook.com/")).toBe(false);
    expect(Quiet.isScrapeHostFacebookUrl("https://www.facebook.com/messages/")).toBe(false);
  });

  it("does not pause while a group tab is focused or during post-scrape grace", () => {
    const scraping = new Set([9]);
    expect(
      Quiet.shouldPauseForFacebook({
        pauseOnFacebook: true,
        activeTabUrl: "https://www.facebook.com/groups/Nexups",
        activeTabId: 1,
        scrapingTabIds: scraping,
        now: 1000,
      }),
    ).toBe(false);
    expect(
      Quiet.shouldPauseForFacebook({
        pauseOnFacebook: true,
        activeTabUrl: "https://www.facebook.com/messages/",
        activeTabId: 9,
        scrapingTabIds: scraping,
        now: 1000,
      }),
    ).toBe(false);
    expect(
      Quiet.shouldPauseForFacebook({
        pauseOnFacebook: true,
        activeTabUrl: "https://www.facebook.com/messages/",
        activeTabId: 2,
        scrapingTabIds: scraping,
        graceUntil: 5000,
        now: 1000,
      }),
    ).toBe(false);
    expect(
      Quiet.shouldPauseForFacebook({
        pauseOnFacebook: true,
        activeTabUrl: "https://www.facebook.com/messages/",
        activeTabId: 2,
        scrapingTabIds: scraping,
        now: 1000,
      }),
    ).toBe(true);
    expect(Quiet.shouldPauseForFacebook({ pauseOnFacebook: false, activeTabUrl: "https://www.facebook.com/", now: 1 })).toBe(false);
  });
});
