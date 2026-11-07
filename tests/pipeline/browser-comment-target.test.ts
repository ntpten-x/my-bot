import { expect, it } from "vitest";
import { browserTarget } from "../../src/lib/auto-comment/browser";

it("matches normalized post URLs against source slugs that retain original case", () => {
  const expected = { key: "group:nexups:12345", area: "group:nexups", url: "https://www.facebook.com/groups/nexups/posts/12345/" };
  expect(browserTarget("https://www.facebook.com/groups/nexups/posts/12345", "https://www.facebook.com/groups/Nexups", "facebook_group")).toEqual(expected);
  expect(browserTarget("https://web.facebook.com/groups/NEXUPS/permalink/12345/", "https://www.facebook.com/groups/nexups", "facebook_group")).toEqual(expected);
});

it("still rejects different groups, comment links, collections, Marketplace and foreign origins", () => {
  const source = "https://www.facebook.com/groups/Nexups";
  for (const url of [
    "https://www.facebook.com/groups/other/posts/12345/",
    "https://www.facebook.com/groups/nexups/posts/12345/?comment_id=9",
    "https://www.facebook.com/groups/nexups/posts/12345/?reply_comment_id=9",
    "https://www.facebook.com/groups/nexups?multi_permalinks=12345",
    "https://www.facebook.com/marketplace/item/12345",
    "https://evilfacebook.com/groups/nexups/posts/12345",
    "http://www.facebook.com/groups/nexups/posts/12345",
  ]) expect(browserTarget(url, source, "facebook_group")).toBeNull();
});
