import { expect, it } from "vitest";
import { classifyWithChain } from "../../src/lib/pipeline/classify";
import { flattenSeeds } from "../../src/lib/pipeline/catalog";

it("tracks the provider for each post when AI only answers part of a batch", async () => {
  const outcome = await classifyWithChain({
    posts: [{ id: "answered", text: "ตามหาช่างล้างแอร์" }, { id: "missing", text: "ตามหาช่างซ่อมบ้าน" }],
    catalog: flattenSeeds(),
    providers: [{ name: "ollama", classify: async () => [{ id: "answered", intent: "buyer" }] }],
  });
  expect(outcome).toHaveProperty("providersById", { answered: "ollama", missing: "rules" });
});
