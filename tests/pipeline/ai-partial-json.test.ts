import { expect, it } from "vitest";
import { extractAiItems } from "../../src/lib/ai/parse";
import { classifyWithChain } from "../../src/lib/pipeline/classify";

it("keeps complete items from a truncated response, never the unfinished item", () => {
  const first = { id: "one", intent: "buyer", suggestedReply: 'ราคา {test} "quoted"' };
  expect(extractAiItems(`\`\`\`json\n{"items":[${JSON.stringify(first)},{"id":"two","intent":"buy`)).toEqual([first]);
  expect(extractAiItems('[{"id":"one","intent":"buyer"},')).toEqual([{ id: "one", intent: "buyer" }]);
});
it("does not invent results from malformed objects or unrelated nested arrays", () => {
  expect(() => extractAiItems('{"items":[{"id":"one",BROKEN}]}')).toThrow();
  expect(() => extractAiItems('{"debug":{"items":[{"id":"one"}]')).toThrow();
  expect(() => extractAiItems('{"items":[{"id":"unfinished"')).toThrow();
});
it("only sends unanswered IDs to the fallback provider", async () => {
  let fallbackIds: string[] = [];
  const result = await classifyWithChain({ posts: [{ id: "one", text: "หาไอแพด" }, { id: "two", text: "ขายไอแพด" }], catalog: [], providers: [
    { name: "partial", classify: async () => extractAiItems('{"items":[{"id":"one","intent":"buyer"},{"id":') },
    { name: "fallback", classify: async posts => { fallbackIds = posts.map(p => p.id); return posts.map(p => ({ id: p.id, intent: "seller" })); } },
  ] });
  expect(fallbackIds).toEqual(["two"]);
  expect(result.providersById).toEqual({ one: "partial", two: "fallback" });
});
