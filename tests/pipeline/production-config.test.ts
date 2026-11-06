import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertProductionConfig, productionConfigChecks } from "../../src/lib/production-config";

const valid = {
  NODE_ENV: "production", AI_KEY_SECRET: "test-only-master-secret-123",
  DATABASE_URL: "postgresql://test:fake@db.test:6543/postgres?pgbouncer=true&sslmode=require",
  DIRECT_URL: "postgresql://test:fake@db.test:5432/postgres?sslmode=require",
};
describe("production configuration guards", () => {
  it("blocks missing configuration, rejects short keys and wrong pooler modes", () => {
    expect(productionConfigChecks({}).filter(check => check.status === "BLOCKED").length).toBeGreaterThan(0);
    expect(() => assertProductionConfig({ NODE_ENV: "production" })).toThrow(/AI_KEY_SECRET, DATABASE_URL, DIRECT_URL/);
    expect(() => assertProductionConfig({ ...valid, AI_KEY_SECRET: "short" })).toThrow(/AI_KEY_SECRET/);
    expect(() => assertProductionConfig({ ...valid, DIRECT_URL: valid.DATABASE_URL })).toThrow(/DIRECT_URL/);
    expect(() => assertProductionConfig(valid)).not.toThrow();
  });
  it("keeps values out of both readiness output and startup errors", () => {
    const env = { ...valid, AI_KEY_SECRET: "short-secret", DATABASE_URL: "not-a-url-with-fake-secret" };
    const report = JSON.stringify(productionConfigChecks(env));
    expect(report).not.toContain(env.AI_KEY_SECRET);
    expect(report).not.toContain(env.DATABASE_URL);
    try { assertProductionConfig(env); } catch (error) {
      expect(String(error)).not.toContain(env.AI_KEY_SECRET);
      expect(String(error)).not.toContain(env.DATABASE_URL);
    }
  });
  it("flags remote TLS verification as blocked and preserves local development", () => {
    const report = productionConfigChecks({ ...valid, DIRECT_URL: "postgresql://test:fake@db.test:5432/postgres" });
    expect(report.find(check => check.id === "DIRECT_URL_TLS")?.status).toBe("BLOCKED");
    expect(() => assertProductionConfig({ NODE_ENV: "development" })).not.toThrow();
  });
  it("passes production mode to the worker while preserving its role", () => {
    const code = `import {childEnvironment} from './scripts/runtime-env.mjs'; const env=childEnvironment({NODE_ENV:'development'},true,{MYBOT_PROCESS:'worker'}); process.stdout.write(JSON.stringify(env));`;
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" });
    expect(JSON.parse(output)).toMatchObject({ NODE_ENV: "production", MYBOT_PROCESS: "worker" });
  });

  it("fails the CI gate when the test database is absent, before suites can be skipped", () => {
    expect(() => execFileSync(process.execPath, ["scripts/test-ci.mjs"], {
      env: { ...process.env, TEST_DATABASE_URL: "" }, stdio: ["ignore", "pipe", "pipe"],
    })).toThrow();
  });
});
