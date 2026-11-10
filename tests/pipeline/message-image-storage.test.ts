import { expect, it } from "vitest";
import {
  MESSAGE_IMAGE_MAX_BYTES,
  messageImageObjectPath,
  validateMessageImage,
} from "../../src/lib/supabase-storage";

it("accepts jpeg/png/webp under 2MB and builds a template object path", () => {
  expect(validateMessageImage({ mime: "image/jpeg", bytes: 12 })).toBeNull();
  expect(validateMessageImage({ mime: "image/png", bytes: 12 })).toBeNull();
  expect(validateMessageImage({ mime: "image/webp", bytes: 12 })).toBeNull();
  expect(validateMessageImage({ mime: "image/gif", bytes: 12 })).toMatch(/JPEG/);
  expect(validateMessageImage({ mime: "image/png", bytes: MESSAGE_IMAGE_MAX_BYTES + 1 })).toMatch(/2 MB/);
  expect(messageImageObjectPath("tmpl_1", "image/png")).toMatch(/^templates\/tmpl_1\/.+\.png$/);
});
