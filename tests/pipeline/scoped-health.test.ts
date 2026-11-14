import { expect, it } from "vitest";
import { scopedHealth } from "../../scripts/scoped-health.mjs";
it("rejects unapproved deployment origins without sending traffic", async () => {
  for (const origin of ["http://localhost:8001", "https://mb-agcf.onrender.com.evil.example", "https://user:secret@mb-agcf.onrender.com", "https://mb-agcf.onrender.com/path"]) await expect(scopedHealth(origin)).rejects.toThrow("scope");
});
