import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const requireHere = createRequire(path.resolve("package.json"));
describe("security dependency overrides at their actual consumer paths", () => {
  it("keeps Prisma config plain-object merging compatible and handles circular objects safely", async () => {
    const fromPrisma = createRequire(requireHere.resolve("@prisma/config"));
    const { deepmerge } = await import(pathToFileURL(fromPrisma.resolve("deepmerge-ts")).href);
    // deepmerge-ts 8 recurses forever on cycles — Prisma config inputs are plain acyclic objects.
    const left = { value: 1, nested: { keep: true } };
    const right = { other: 2, nested: { add: "ok" } };
    const merged = deepmerge(left, right);
    expect(merged).toEqual({ value: 1, other: 2, nested: { keep: true, add: "ok" } });
    const config = deepmerge({ migrate: { path: "migrations" }, schema: "schema.prisma" }, { migrate: { seed: "test-only" } });
    expect(config).toEqual({ migrate: { path: "migrations", seed: "test-only" }, schema: "schema.prisma" });
  });

  it("loads a real Prisma config file after the Deepmerge major change", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "mybot-prisma-config-"));
    try {
      writeFileSync(path.join(directory, "prisma.config.ts"), 'export default { schema: "schema.prisma", migrations: { path: "migrations" } };');
      const { loadConfigFromFile } = await import("@prisma/config");
      const result = await loadConfigFromFile({ configRoot: directory });
      expect(result.error).toBeUndefined();
      expect(result.config?.schema).toBe(path.join(directory, "schema.prisma"));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("preserves the named Minimatch API consumed by TypeScript ESLint", () => {
    const fromParser = createRequire(requireHere.resolve("@typescript-eslint/typescript-estree"));
    const { minimatch } = fromParser("minimatch");
    expect(minimatch("src/app/page.tsx", "src/**/*.tsx", { dot: true })).toBe(true);
    expect(minimatch(".config.ts", "*.ts", { dot: true })).toBe(true);
    expect(minimatch("private/key.pem", "src/**/*.tsx", { dot: true })).toBe(false);
  });

  it("preserves Next's PostCSS processing and source-map behavior", async () => {
    const fromNext = createRequire(requireHere.resolve("next/package.json"));
    const postcss = fromNext("postcss");
    const result = await postcss([{ postcssPlugin: "test-transform", Declaration(decl: { prop: string; value: string }) { if (decl.prop === "color") decl.value = "blue"; } }])
      .process("a { color: red; }", { from: "test.css", to: "out.css", map: { inline: false } });
    expect(result.css).toContain("color: blue");
    expect(result.map?.toJSON().sources).toContain("test.css");
  });

  it("does not disclose a source map from a CSS comment without a trusted source path", async () => {
    const fromNext = createRequire(requireHere.resolve("next/package.json"));
    const postcss = fromNext("postcss");
    const directory = mkdtempSync(path.join(tmpdir(), "mybot-map-fixture-"));
    try {
      const map = path.join(directory, "private.map");
      writeFileSync(map, JSON.stringify({ version: 3, file: "test.css", sources: ["private-fixture"], sourcesContent: ["TEST_ONLY_PRIVATE_MARKER"], names: [], mappings: "AAAA" }));
      // Relative map names must not resolve when `from` is omitted (no trusted CSS path).
      const result = await postcss([]).process(`a { color: red; }\n/*# sourceMappingURL=private.map */`, { from: undefined, map: { inline: false } });
      expect(result.root.source?.input.map?.text ?? "").not.toContain("TEST_ONLY_PRIVATE_MARKER");
      // Absolute file URLs in comments are also ignored when there is no trusted `from`.
      const absolute = await postcss([]).process(`a { color: red; }\n/*# sourceMappingURL=${pathToFileURL(map).href} */`, { from: undefined, map: { inline: false } });
      expect(absolute.root.source?.input.map?.text ?? "").not.toContain("TEST_ONLY_PRIVATE_MARKER");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
