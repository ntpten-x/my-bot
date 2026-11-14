import "../src/lib/load-env";
import { Prisma, PrismaClient } from "@prisma/client";
import { serverSecret } from "../src/lib/server-secret";
const args = new Set(process.argv.slice(2));
const models = Prisma.dmmf.datamodel.models.map(model => model.name);
async function main() {
if (args.has("--role-sql")) {
  console.log(`-- Review only. Run through the migration/admin connection, never the app login.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mybot_runtime') THEN
 CREATE ROLE mybot_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
END IF; END $$;
GRANT USAGE ON SCHEMA public TO mybot_runtime;`);
  for (const table of models) {
    if (!/^\w+$/.test(table)) throw Error("Unexpected model name");
    const rights = table === "SecurityAudit" ? "SELECT, INSERT" : table === "SecurityAuditHead" ? "SELECT, INSERT, UPDATE" : "SELECT, INSERT, UPDATE, DELETE";
    console.log(`GRANT ${rights} ON TABLE public."${table}" TO mybot_runtime;
DROP POLICY IF EXISTS mybot_runtime_access ON public."${table}";
CREATE POLICY mybot_runtime_access ON public."${table}" TO mybot_runtime USING (true) WITH CHECK (true);`);
  }
  console.log("-- Create a separate LOGIN with a password through your provider's secret workflow.\n-- That LOGIN must not own these tables or have BYPASSRLS/superuser. Grant mybot_runtime to it.\n-- Use it only in DATABASE_URL; keep migration admin credentials out of the web runtime.");
} else {
  const checks = [
    { name: "canonical origin configured", pass: Boolean(process.env.AUTH_URL) },
    { name: "master secret configured", pass: serverSecret("AI_KEY_SECRET").length >= 16 },
    { name: "recovery token configured", pass: serverSecret("BOOTSTRAP_TOKEN").length >= 24 },
    { name: "dedicated audit key configured", pass: serverSecret("SECURITY_AUDIT_KEY").length >= 32 },
    { name: "off-host encrypted backup configured", pass: Boolean(process.env.BACKUP_UPLOAD_URL) && (serverSecret("BACKUP_ENCRYPTION_KEY") || serverSecret("AI_KEY_SECRET")).length >= 16 },
    { name: "legacy sessions disabled", pass: process.env.AUTH_ALLOW_LEGACY_SESSIONS !== "1" },
    { name: "legacy extension bearer disabled", pass: process.env.AUTH_ALLOW_LEGACY_EXTENSION_TOKEN !== "1" },
    { name: "all-host release gate confirmed", pass: process.env.SECURITY_RELEASE_READY === "1" },
  ];
  for (const row of checks) console.log(`${row.pass ? "PASS" : "FAIL"} ${row.name}`);
  if (args.has("--db")) {
    const db = new PrismaClient();
    try {
      const [role] = await db.$queryRaw<Array<{ privileged: boolean; owns_tables: boolean }>>`SELECT r.rolsuper OR r.rolbypassrls AS privileged, EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relowner=r.oid AND c.relkind='r') AS owns_tables FROM pg_roles r WHERE r.rolname=current_user`;
      const tables = await db.$queryRaw<Array<{ name: string; rls: boolean }>>`SELECT c.relname AS name,c.relrowsecurity AS rls FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relkind='r'`;
      const unprotected = models.filter(name => !tables.some(row => row.name === name && row.rls));
      console.log(`${role && !role.privileged && !role.owns_tables ? "PASS" : "FAIL"} runtime role is non-owner without superuser/BYPASSRLS`);
      console.log(`${!unprotected.length ? "PASS" : "FAIL"} RLS covers all ${models.length} models (missing/disabled ${unprotected.length})`);
      if (!role || role.privileged || role.owns_tables || unprotected.length) process.exitCode = 1;
    } finally { await db.$disconnect(); }
  } else console.log("NOT_TESTED live database permissions (add --db for read-only inspection)");
  if (checks.some(row => !row.pass)) process.exitCode = 1;
}

}
main().catch(() => { console.error("FAIL security inspection (configuration and credentials withheld)"); process.exitCode = 1; });
