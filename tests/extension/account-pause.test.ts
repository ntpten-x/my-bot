import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
const source = readFileSync("extension/background.js", "utf8");
async function config(stored: Record<string, unknown>) {
  const context = vm.createContext({ URL, chrome: { storage: { local: { get: async (defaults: object) => ({ ...defaults, ...stored }) } } }, base: (cfg: { apiBase: string }) => cfg.apiBase.replace(/\/$/, "") });
  vm.runInContext(source.slice(source.indexOf("const DEFAULTS"), source.indexOf("// The MY-BOT page bridge")), context);
  return vm.runInContext("loadConfig()", context);
}
it("applies an account pause only to the matching server and Facebook account without changing the local pause switch", async () => {
  const stored = { token: "synthetic", apiBase: "https://owner.example", fbIdentity: { id: "12345", loggedIn: true }, serverAccountControl: { apiBase: "https://owner.example", fbUserId: "12345", paused: true } };
  expect(await config(stored)).toMatchObject({ paused: false, accountPaused: true });
  expect(await config({ ...stored, fbIdentity: { id: "67890", loggedIn: true } })).toMatchObject({ accountPaused: false });
  expect(await config({ ...stored, apiBase: "https://other.example" })).toMatchObject({ accountPaused: false });
});
