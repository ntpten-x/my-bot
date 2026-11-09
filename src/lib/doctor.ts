export type DoctorStatus = "PASS" | "WARN" | "FAIL";

export type DoctorCheck = {
  id: string;
  status: DoctorStatus;
  label: string;
  hint: string;
};

export type DoctorFacts = {
  nodeMajor: number;
  depsInstalled: boolean;
  env: {
    databaseUrl: boolean;
    /** "postgres" for Supabase/Postgres, "sqlite" for an old file: URL. */
    databaseKind?: "postgres" | "sqlite" | "other";
    directUrl?: boolean;
    port: boolean;
    groq: boolean;
    gemini: boolean;
    discord: boolean;
  };
  dbOk: boolean;
  portState: "ours" | "free" | "busy";
  ollamaReachable: boolean;
  ollamaModels: string[];
  embedOk: boolean;
  embedDetail: string;
  groqReachable: boolean | null;
  geminiReachable: boolean | null;
  extensionToken: boolean;
};

export function hasModel(models: string[], base: string) {
  const bare = base.replace(/:latest$/, "");
  return models.some((name) => name === bare || name === `${bare}:latest` || name.startsWith(`${bare}:`));
}

export function evaluateDoctor(facts: DoctorFacts): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  checks.push(
    facts.nodeMajor >= 20
      ? { id: "node", status: "PASS", label: `Node ${facts.nodeMajor}`, hint: "" }
      : { id: "node", status: "FAIL", label: `Node ${facts.nodeMajor || "missing"}`, hint: "ติดตั้ง Node.js 20 LTS จาก https://nodejs.org แล้วเปิดเทอร์มินัลใหม่" },
  );
  checks.push(
    facts.depsInstalled
      ? { id: "deps", status: "PASS", label: "ติดตั้งแพ็กเกจแล้ว", hint: "" }
      : { id: "deps", status: "FAIL", label: "ยังไม่มี node_modules", hint: "รัน npm install ในโฟลเดอร์โปรเจกต์" },
  );
  checks.push(
    facts.env.databaseUrl
      ? { id: "env-db", status: "PASS", label: "มี DATABASE_URL", hint: "" }
      : { id: "env-db", status: "FAIL", label: "ไม่มี DATABASE_URL", hint: "ใส่ DATABASE_URL ของ Supabase ใน .env (ดู docs/SETUP.th.md)" },
  );
  if (facts.env.databaseUrl && facts.env.databaseKind === "sqlite") {
    checks.push({ id: "env-db-kind", status: "FAIL", label: "DATABASE_URL ยังชี้ไปที่ไฟล์ SQLite", hint: "ระบบย้ายไป Supabase แล้ว ใส่ DATABASE_URL และ DIRECT_URL ของ Supabase ใน .env (ดู docs/SETUP.th.md)" });
  }
  if (facts.env.databaseKind === "postgres" && facts.env.directUrl === false) {
    checks.push({ id: "env-direct", status: "WARN", label: "ไม่มี DIRECT_URL", hint: "ใส่ DIRECT_URL (Session pooler พอร์ต 5432) ใน .env ไม่งั้น prisma migrate อาจค้างผ่าน pgbouncer" });
  }
  checks.push(
    facts.env.port
      ? { id: "env-port", status: "PASS", label: "มี PORT", hint: "" }
      : { id: "env-port", status: "WARN", label: "ไม่ได้ตั้ง PORT", hint: "ใส่ PORT=8001 ใน .env" },
  );
  checks.push(
    facts.env.discord
      ? { id: "env-discord", status: "PASS", label: "มี Discord webhook", hint: "" }
      : { id: "env-discord", status: "WARN", label: "ไม่มี Discord webhook", hint: "ไม่บังคับ ใส่ DISCORD_WEBHOOK_URL ถ้าต้องการแจ้งเตือนเข้าดิสคอร์ด" },
  );
  checks.push(
    facts.dbOk
      ? { id: "db", status: "PASS", label: "ฐานข้อมูลพร้อม", hint: "" }
      : { id: "db", status: "FAIL", label: "ฐานข้อมูลยังไม่พร้อม", hint: "เช็กว่าเน็ตต่อได้และ DATABASE_URL/รหัสผ่าน Supabase ใน .env ถูกต้อง แล้วรัน npm run db:migrate และ npm run db:seed" },
  );
  if (facts.portState === "ours") {
    checks.push({ id: "port", status: "PASS", label: "พอร์ต 8001 ตอบโดย MY-BOT", hint: "" });
  } else if (facts.portState === "free") {
    checks.push({ id: "port", status: "WARN", label: "พอร์ต 8001 ว่าง", hint: "เริ่มแอปด้วย npm run dev หรือ npm run start:prod" });
  } else {
    checks.push({ id: "port", status: "FAIL", label: "พอร์ต 8001 ถูกโปรแกรมอื่นใช้", hint: "ปิดโปรแกรมนั้น หรือเปลี่ยน PORT ใน .env และในส่วนขยาย" });
  }
  checks.push(
    facts.extensionToken
      ? { id: "token", status: "PASS", label: "มีโทเคนส่วนขยาย", hint: "" }
      : { id: "token", status: "FAIL", label: "ไม่มีโทเคนส่วนขยาย", hint: "รัน npm run db:seed แล้วเปิดหน้าตั้งค่า" },
  );
  return checks;
}

export function doctorExitCode(checks: DoctorCheck[]) {
  return checks.some((check) => check.status === "FAIL") ? 1 : 0;
}
