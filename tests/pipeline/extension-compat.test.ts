import { expect, it } from "vitest";
import {
  EXPECTED_EXTENSION_VERSION,
  MINIMUM_EXTENSION_VERSION,
  isCompatibleExtensionVersion,
  isCurrentExtensionVersion,
} from "../../src/lib/extension-heartbeat";

it("requires the reviewed extension build while allowing newer same-minor patches", () => {
  expect(EXPECTED_EXTENSION_VERSION).toBe("1.11.35");
  expect(MINIMUM_EXTENSION_VERSION).toBe("1.11.35");
  expect(isCurrentExtensionVersion("1.11.35")).toBe(true);
  expect(isCurrentExtensionVersion("1.11.31")).toBe(false);
  expect(isCompatibleExtensionVersion("1.11.29")).toBe(false);
  expect(isCompatibleExtensionVersion("1.11.30")).toBe(false);
  expect(isCompatibleExtensionVersion("1.11.31")).toBe(false);
  expect(isCompatibleExtensionVersion("1.11.34")).toBe(false);
  expect(isCompatibleExtensionVersion("1.11.35")).toBe(true);
  expect(isCompatibleExtensionVersion("1.11.36")).toBe(true);
  expect(isCompatibleExtensionVersion("1.11.18")).toBe(false);
  expect(isCompatibleExtensionVersion("1.10.99")).toBe(false);
  expect(isCompatibleExtensionVersion("")).toBe(false);
});
