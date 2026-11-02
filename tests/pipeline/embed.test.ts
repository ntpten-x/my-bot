import { describe, expect, it } from "vitest";
import { ollamaBaseCandidates } from "../../src/lib/ai/ollama-url";
import { ollamaEmbedModels, parseOllamaEmbedding } from "../../src/lib/smart/embed";

describe("ollama embedding", () => {
  it("tries port 11434 before 41434 when nothing else is configured", () => {
    expect(ollamaBaseCandidates()).toEqual(["http://127.0.0.1:11434", "http://127.0.0.1:41434"]);
    expect(ollamaBaseCandidates("http://127.0.0.1:11434")).toEqual([
      "http://127.0.0.1:11434",
      "http://127.0.0.1:41434",
    ]);
  });

  it("matches bge-m3 to the installed bge-m3:latest tag", () => {
    expect(ollamaEmbedModels("bge-m3", ["qwen2.5:7b", "bge-m3:latest"])[0]).toBe("bge-m3:latest");
  });

  it("reads nested, flat, and legacy embedding payloads", () => {
    expect(parseOllamaEmbedding({ embeddings: [[0.1, 0.2]] })).toEqual([0.1, 0.2]);
    expect(parseOllamaEmbedding({ embeddings: [0.3, 0.4] })).toEqual([0.3, 0.4]);
    expect(parseOllamaEmbedding({ embedding: [0.5, 0.6] })).toEqual([0.5, 0.6]);
    expect(parseOllamaEmbedding({ embeddings: [] })).toBeNull();
  });
});
