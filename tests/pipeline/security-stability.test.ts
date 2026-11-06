import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACKUP_TABLES } from "../../src/lib/backup";
import { aiCacheKey } from "../../src/lib/pipeline/classify";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const models = [...schema.matchAll(/^model (\w+)/gm)].map(match => match[1]);

describe("security and recovery regression gates", () => {
  it("enables RLS for every application table across deployed migrations", () => {
    const sql = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => readFileSync(`prisma/migrations/${entry.name}/migration.sql`, "utf8")).join("\n");
    const protectedTables = [...sql.matchAll(/ALTER TABLE(?: IF EXISTS)? "(\w+)" ENABLE ROW LEVEL SECURITY/gi)].map(match => match[1]);
    expect(models.filter(model => !protectedTables.includes(model))).toEqual([]);
  });

  it("accounts for every model in the backup format", () => {
    expect(models.filter(model => !(BACKUP_TABLES as readonly string[]).includes(model))).toEqual([]);
  });

  it("captures only the secret, including an empty answer, without capturing the prompt", () => {
    const script = readFileSync("scripts/setup.sh", "utf8");
    const fn = script.slice(script.indexOf("read_secret()"), script.indexOf("set_env()"));
    for (const answer of ["", "fake-test-value"]) {
      const result = execFileSync("bash", ["-c", `${fn}\nstty() { :; }\nread_secret TEST_KEY`], {
        input: `${answer}\n`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
      });
      expect(result).toBe(answer);
    }
  });

  it("keeps shell metacharacters literal and does not expose values in argv", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mybot-env-test-"));
    try {
      writeFileSync(path.join(dir, ".env"), 'TEST_KEY="old"\nOTHER="unchanged"\n');
      const value = "test-$HOME-$(false)-`false`-a&b\\c#end'";
      execFileSync(process.execPath, [path.resolve("scripts/set-env.mjs"), "TEST_KEY"], { cwd: dir, input: value, stdio: ["pipe", "pipe", "pipe"] });
      const result = readFileSync(path.join(dir, ".env"), "utf8");
      expect(result).toBe(`TEST_KEY="${value}"\nOTHER="unchanged"\n`);
      expect(() => execFileSync(process.execPath, [path.resolve("scripts/set-env.mjs"), "TEST_KEY"], { cwd: dir, input: "bad\nINJECT=value", stdio: ["pipe", "pipe", "pipe"] })).toThrow();
      expect(readFileSync(path.join(dir, ".env"), "utf8")).toBe(result);
      writeFileSync(path.join(dir, ".env"), '  TEST_KEY = "first"\nTEST_KEY="last"\n');
      execFileSync(process.execPath, [path.resolve("scripts/set-env.mjs"), "TEST_KEY"], { cwd: dir, input: "new", stdio: ["pipe", "pipe", "pipe"] });
      expect(readFileSync(path.join(dir, ".env"), "utf8")).toBe('TEST_KEY="new"\n');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("does not reuse an earlier text/OCR result even with a stale supplied content hash", () => {
    expect(aiCacheKey("old text", [], "same-hash")).not.toBe(aiCacheKey("new text", [], "same-hash"));
  });

  it("preserves TLS/schema URL options when deriving pooled and direct connections", () => {
    const value = "postgresql://test:test@127.0.0.1:6543/db?sslmode=require&schema=test_setup&connection_limit=3&pgbouncer=false";
    const output = execFileSync(process.execPath, [path.resolve("scripts/database-urls.mjs")], { input: value, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const [pool, direct] = output.split("\n").map(url => new URL(url));
    expect(pool.searchParams.get("sslmode")).toBe("require");
    expect(pool.searchParams.get("schema")).toBe("test_setup");
    expect(pool.searchParams.get("pgbouncer")).toBe("true");
    expect(pool.searchParams.get("connection_limit")).toBe("3");
    expect(direct.port).toBe("5432");
    expect(direct.searchParams.has("pgbouncer")).toBe(false);
    expect(direct.searchParams.get("sslmode")).toBe("require");
  });
});
