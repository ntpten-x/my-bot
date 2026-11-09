import { expect, it } from "vitest";
import { browserTarget } from "../../src/lib/auto-comment/browser";
import { facebookGroupKey, postBelongsToSource } from "../../src/lib/sources";

it("accepts vanity or learned numeric Facebook group ids for source ownership", () => {
  const source = { url: "https://www.facebook.com/groups/ShoeBuyers", type: "facebook_group", fbGroupId: "123456789012345" };
  expect(facebookGroupKey(source.url)).toBe("shoebuyers");
  expect(postBelongsToSource("https://www.facebook.com/groups/ShoeBuyers/posts/99/", source)).toBe(true);
  expect(postBelongsToSource("https://www.facebook.com/groups/123456789012345/posts/99/", source)).toBe(true);
  expect(postBelongsToSource("https://www.facebook.com/groups/other-group/posts/99/", source)).toBe(false);
  expect(postBelongsToSource("https://www.facebook.com/marketplace/item/1", { url: "https://www.facebook.com/marketplace/bangkok", type: "facebook_marketplace" })).toBe(true);
});

it("keeps browser comment keys on the configured source slug while allowing numeric aliases", () => {
  const sourceUrl = "https://www.facebook.com/groups/ShoeBuyers";
  const vanity = browserTarget("https://www.facebook.com/groups/ShoeBuyers/posts/99/", sourceUrl, "facebook_group");
  const numeric = browserTarget("https://www.facebook.com/groups/123456789012345/posts/99/", sourceUrl, "facebook_group", ["123456789012345"]);
  const rejected = browserTarget("https://www.facebook.com/groups/123456789012345/posts/99/", sourceUrl, "facebook_group");
  expect(vanity?.key).toBe("group:shoebuyers:99");
  expect(numeric?.key).toBe("group:shoebuyers:99");
  expect(rejected).toBeNull();
});
