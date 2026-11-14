import { afterEach, expect, it, vi } from "vitest";
import { encryptSecret, decryptSecret } from "../../src/lib/ai/secret-box";
afterEach(() => vi.unstubAllEnvs());
it("decrypts retained old ciphertext during a coordinated key rotation and writes only with the new key", () => {
  vi.stubEnv("AI_KEY_SECRET", "synthetic-previous-key-32-characters");
  const old = encryptSecret("synthetic-secret-payload");
  vi.stubEnv("AI_KEY_SECRET", "synthetic-current-key-32-characters");
  vi.stubEnv("AI_KEY_SECRET_PREVIOUS", JSON.stringify(["synthetic-previous-key-32-characters"]));
  expect(decryptSecret(old)).toBe("synthetic-secret-payload");
  const current = encryptSecret("synthetic-secret-payload");
  vi.stubEnv("AI_KEY_SECRET_PREVIOUS", "[]");
  expect(decryptSecret(current)).toBe("synthetic-secret-payload");
  expect(() => decryptSecret(old)).toThrow();
});
