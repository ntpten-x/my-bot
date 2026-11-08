import { expect, it } from "vitest";
import { extensionFiles, extensionZip } from "../../src/lib/extension-package";

it("packages only public origin configuration and explicitly scoped install permissions", () => {
  const files = extensionFiles(undefined, "https://custom.example");
  const config = JSON.parse(files.find(file => file.name.endsWith("/install-config.json"))!.data.toString());
  expect(config).toEqual({ apiBase: "https://custom.example" });
  const manifest = JSON.parse(files.find(file => file.name.endsWith("/manifest.json"))!.data.toString());
  expect(manifest.host_permissions).toContain("https://custom.example/*");
  expect(manifest.content_scripts.find((script: {js:string[]})=>script.js.includes("bridge.js"))).toMatchObject({ matches: expect.arrayContaining(["https://custom.example/*"]), js: expect.arrayContaining(["connect-page.js"]) });
  expect(files.some(file=>file.name.endsWith("/connect.js"))).toBe(true);
  expect(manifest.permissions).not.toContain("cookies");
  expect(manifest).not.toHaveProperty("externally_connectable");
});
it("rejects credential-bearing URLs and remote plaintext origins", () => {
  for (const origin of ["http://remote.example", "https://owner:password@custom.example", "https://custom.example/path", "https://custom.example?token=bad"]) expect(()=>extensionFiles(undefined,origin)).toThrow();
  expect(()=>extensionFiles(undefined,"http://localhost:8001")).not.toThrow();
});
it("does not serve a cached bundle configured for another origin", () => {
  const one = extensionZip("https://one.example"), two = extensionZip("https://two.example");
  expect(one.equals(two)).toBe(false);
  expect(extensionZip("https://one.example").equals(one)).toBe(true);
});
