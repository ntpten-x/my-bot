import "../src/lib/load-env";
import { prisma } from "../src/lib/prisma";
import { appendSecurityAudit } from "../src/lib/security-audit";
const apply = process.argv.includes("--apply");
async function main() {
  const counts = { sessions: await prisma.session.count(), retiredIdentities: await prisma.authUser.count() };
  console.log(JSON.stringify({ mode: apply ? "apply" : "read-only-plan", ...counts }));
  if (!apply) return;
  if (process.env.SECURITY_RELEASE_READY !== "1") throw Error("Confirm all web hosts run the same verified release before cutover");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(71024, 1)`;
    await tx.$queryRaw`SELECT id FROM "Owner" ORDER BY id FOR UPDATE`;
    await tx.owner.updateMany({ data: { authVersion: { increment: 1 }, mfaPendingSecret: null, mfaPendingExpiresAt: null } });
    await tx.session.deleteMany(); await tx.authUser.deleteMany(); await tx.authVerification.deleteMany(); await tx.authRateLimit.deleteMany();
    await appendSecurityAudit("sessions.cutover", null, "success", tx);
  });
  console.log("PASS session cutover; passwords, paired extension devices and comment controls unchanged");
}
main().catch(() => { console.error("FAIL security cutover (credentials withheld)"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
