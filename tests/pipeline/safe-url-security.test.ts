import { expect, it } from "vitest";
import { safeHttpUrl } from "../../src/lib/safe-url";
it("never publishes executable URLs or embedded credentials from imported content", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<script>evil</script>", "file:///etc/passwd", "https://user:secret@example.com", "not a url"]) expect(safeHttpUrl(url)).toBe("");
  expect(safeHttpUrl("https://www.facebook.com/groups/123/posts/456")).toBe("https://www.facebook.com/groups/123/posts/456");
});
