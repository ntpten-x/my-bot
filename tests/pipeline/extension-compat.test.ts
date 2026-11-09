import { expect, it } from "vitest";
import {
  EXPECTED_EXTENSION_VERSION,
  MINIMUM_EXTENSION_VERSION,
  isCompatibleExtensionVersion,
  isCurrentExtensionVersion,
} from "../../src/lib/extension-heartbeat";

it("accepts the expected extension build and recent patches on the same minor line", () => {
  expect(EXPECTED_EXTENSION_VERSION).toBe("1.11.24");
  expect(MINIMUM_EXTENSION_VERSION).toBe("1.11.19");
  expect(isCurrentExtensionVersion("1.11.24")).toBe(true);
  expect(isCompatibleExtensionVersion("1.11.24")).toBe(true);
  expect(isCompatibleExtensionVersion("1.11.23")).toBe(true);
  expect(isCompatibleExtensionVersion("1.11.20")).toBe(true);
  expect(isCompatibleExtensionVersion("1.11.19")).toBe(true);
  expect(isCompatibleExtensionVersion("1.11.18")).toBe(false);
  expect(isCompatibleExtensionVersion("1.10.99")).toBe(false);
  expect(isCompatibleExtensionVersion("")).toBe(false);
});
