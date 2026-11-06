export type ReadinessCheck = { id: string; status: "PASS" | "FAIL" | "BLOCKED"; message: string };

/** Pure/read-only: no URLs or secret values appear in the result. */
export function productionConfigChecks(env: NodeJS.ProcessEnv): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const secret = env.AI_KEY_SECRET?.trim();
  checks.push({ id: "AI_KEY_SECRET", status: !secret ? "BLOCKED" : secret.length < 16 ? "FAIL" : "PASS", message: !secret ? "ยังไม่มี Secret ของระบบเป้าหมาย" : secret.length < 16 ? "Secret ต้องยาวอย่างน้อย 16 ตัวอักษร" : "กำหนด Secret แล้ว ต้องยืนยันว่าเป็นค่าเดิมก่อน Deploy" });
  for (const key of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const value = env[key];
    if (!value) { checks.push({ id: key, status: "BLOCKED", message: "ยังไม่ได้กำหนดค่าฐานข้อมูลเป้าหมาย" }); continue; }
    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol) || /YOUR[-_]|\[.*PASSWORD.*\]/i.test(value)) throw new Error("invalid");
      if (key === "DATABASE_URL" && url.port === "6543" && url.searchParams.get("pgbouncer") !== "true") throw new Error("invalid");
      if (key === "DIRECT_URL" && (url.port === "6543" || url.searchParams.get("pgbouncer") === "true")) throw new Error("invalid");
      checks.push({ id: key, status: "PASS", message: "รูปแบบ URL และโหมด Pooler ถูกต้อง ยังไม่ทดสอบการเชื่อมต่อ" });
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      const tls = ["require", "verify-ca", "verify-full"].includes(url.searchParams.get("sslmode") ?? "");
      checks.push({ id: `${key}_TLS`, status: local || tls ? "PASS" : "BLOCKED", message: local ? "ฐานบน Loopback ใช้ได้สำหรับการทดสอบแยก" : tls ? "URL กำหนด TLS แล้ว ต้องตรวจใบรับรองบน Host เป้าหมาย" : "ต้องกำหนดหรือยืนยัน TLS ของฐานระยะไกลก่อน Deploy" });
    } catch { checks.push({ id: key, status: "FAIL", message: "URL ไม่ถูกต้อง เป็น Placeholder หรือใช้โหมด Pooler ผิดประเภท" }); }
  }
  checks.push({ id: "WORKER_START", status: "PASS", message: "ใช้ npm start เพื่อเปิด Web และ Worker; Worker ต้องรับ MYBOT_PROCESS=worker จาก Launcher" });
  checks.push({ id: "CLOUD_AI", status: env.GEMINI_API_KEY || env.GROQ_API_KEY ? "PASS" : "BLOCKED", message: env.GEMINI_API_KEY || env.GROQ_API_KEY ? "มี Env Key; ต้องทดสอบ Provider ด้วยคีย์จริงบน Host เป้าหมาย" : "ไม่มี Env Key; ต้องยืนยัน Provider ใน Settings หรือ Ollama บน Host เป้าหมาย" });
  return checks;
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;
  const required = new Set(["AI_KEY_SECRET", "DATABASE_URL", "DIRECT_URL"]);
  const failed = productionConfigChecks(env).filter(check => required.has(check.id) && check.status !== "PASS");
  if (failed.length) throw new Error(`Production configuration invalid: ${failed.map(check => check.id).join(", ")} (values hidden)`);
}
