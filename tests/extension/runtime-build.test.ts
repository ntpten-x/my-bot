import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";

it("does not use the manifest as proof that cached worker modules were updated", () => {
  const source = readFileSync("extension/background.js", "utf8");
  const build = JSON.parse(readFileSync("extension/manifest.json", "utf8")).version;
  const context = vm.createContext({ chrome: { runtime: { getManifest: () => ({ version: build }) } } });
  vm.runInContext(readFileSync("extension/browser-comment.js", "utf8"), context);
  vm.runInContext(readFileSync("extension/comment-worker.js", "utf8"), context);
  vm.runInContext(source.slice(source.indexOf("const RUNTIME_BUILD ="), source.indexOf("const DEFAULTS =")), context);
  vm.runInContext(source.slice(source.indexOf("function headers(token)"), source.indexOf("function base(cfg)")), context);
  expect(vm.runInContext('headers("synthetic")["x-extension-runtime"]', context)).toBe(build);
  vm.runInContext('MyBotCommentWorker.build = "1.11.17"', context);
  expect(vm.runInContext('headers("synthetic")["x-extension-version"]', context)).toBe(build);
  expect(vm.runInContext('headers("synthetic")["x-extension-runtime"]', context)).toBe("mismatch");
});
