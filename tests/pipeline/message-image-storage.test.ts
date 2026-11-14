import { expect, it } from "vitest";
import {
  MESSAGE_IMAGE_MAX_BYTES,
  messageImageObjectPath,
  validateMessageImage,
} from "../../src/lib/supabase-storage";

it("accepts jpeg/png/webp under 2.5MB and builds a template object path", () => {
  expect(MESSAGE_IMAGE_MAX_BYTES).toBe(Math.floor(2.5 * 1024 * 1024));
  expect(validateMessageImage({ mime: "image/jpeg", bytes: 12 })).toBeNull();
  expect(validateMessageImage({ mime: "image/png", bytes: 12 })).toBeNull();
  expect(validateMessageImage({ mime: "image/webp", bytes: 12 })).toBeNull();
  expect(validateMessageImage({ mime: "image/gif", bytes: 12 })).toMatch(/JPEG/);
  expect(validateMessageImage({ mime: "image/png", bytes: MESSAGE_IMAGE_MAX_BYTES })).toBeNull();
  expect(validateMessageImage({ mime: "image/png", bytes: MESSAGE_IMAGE_MAX_BYTES + 1 })).toMatch(/2\.5 MB/);
  expect(messageImageObjectPath("tmpl_1", "image/png")).toMatch(/^templates\/tmpl_1\/.+\.png$/);
});

it("rejects executable content disguised as an image and checks magic bytes", () => {
  const data = Buffer.from("<svg onload=alert(1)></svg>");
  expect(validateMessageImage({ mime: "image/png", bytes: data.length, data })).not.toBeNull();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(validateMessageImage({ mime: "image/png", bytes: png.length, data: png })).toBeNull();
  expect(validateMessageImage({ mime: "image/jpeg", bytes: png.length, data: png })).not.toBeNull();
});
