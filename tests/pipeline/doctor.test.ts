import { describe, expect, it } from "vitest";
import { doctorExitCode, evaluateDoctor, hasModel, type DoctorFacts } from "../../src/lib/doctor";

function facts(partial: Partial<DoctorFacts> = {}): DoctorFacts {
  return {
    nodeMajor: 22,
    depsInstalled: true,
    env: { databaseUrl: true, port: true, groq: false, gemini: false, discord: false },
    dbOk: true,
    portState: "ours",
    ollamaReachable: true,
    ollamaModels: ["qwen2.5:7b", "bge-m3:latest"],
    embedOk: true,
    embedDetail: "Ollama embedding ready",
    groqReachable: null,
    geminiReachable: null,
    extensionToken: true,
    ...partial,
  };
}

function status(id: string, rows: ReturnType<typeof evaluateDoctor>) {
  return rows.find((row) => row.id === id)?.status;
}

describe("doctor", () => {
  it("passes a healthy machine and warns when optional keys are absent", () => {
    const rows = evaluateDoctor(facts());
    expect(status("node", rows)).toBe("PASS");
    expect(status("ollama", rows)).toBe("PASS");
    expect(status("embed", rows)).toBe("PASS");
    expect(status("env-groq", rows)).toBe("WARN");
    expect(status("env-discord", rows)).toBe("WARN");
    expect(doctorExitCode(rows)).toBe(0);
  });

  it("flags a leftover SQLite DATABASE_URL and a missing DIRECT_URL", () => {
    const sqlite = evaluateDoctor(facts({ env: { databaseUrl: true, databaseKind: "sqlite", port: true, groq: false, gemini: false, discord: false } }));
    expect(status("env-db-kind", sqlite)).toBe("FAIL");
    const pg = evaluateDoctor(facts({ env: { databaseUrl: true, databaseKind: "postgres", directUrl: false, port: true, groq: false, gemini: false, discord: false } }));
    expect(status("env-db-kind", pg)).toBeUndefined();
    expect(status("env-direct", pg)).toBe("WARN");
  });
  it("fails when Node, the database, or the extension token is missing", () => {
    const rows = evaluateDoctor(facts({ nodeMajor: 18, dbOk: false, extensionToken: false, portState: "busy" }));
    expect(status("node", rows)).toBe("FAIL");
    expect(status("db", rows)).toBe("FAIL");
    expect(status("token", rows)).toBe("FAIL");
    expect(status("port", rows)).toBe("FAIL");
    expect(doctorExitCode(rows)).toBe(1);
  });

  it("treats a free app port as a warning and a bad Groq key as a failure", () => {
    const rows = evaluateDoctor(
      facts({
        portState: "free",
        groqReachable: false,
        env: { databaseUrl: true, port: true, groq: true, gemini: true, discord: true },
      }),
    );
    expect(status("port", rows)).toBe("WARN");
    expect(status("groq", rows)).toBe("FAIL");
    expect(rows.find((row) => row.id === "port")?.hint).toContain("start:prod");
  });

  it("matches Ollama tags with and without :latest", () => {
    expect(hasModel(["bge-m3:latest"], "bge-m3")).toBe(true);
    expect(hasModel(["qwen2.5:3b"], "bge-m3")).toBe(false);
  });
});
