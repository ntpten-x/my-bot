import { doctorExitCode } from "../src/lib/doctor";
import { collectDoctorReport } from "../src/lib/doctor-run";
import { prisma } from "../src/lib/prisma";

async function main() {
  const report = await collectDoctorReport();
  console.log(`MY-BOT doctor (port ${report.port})`);
  for (const check of report.checks) {
    const hint = check.hint ? `  ${check.hint}` : "";
    console.log(`${check.status.padEnd(4)}  ${check.id.padEnd(12)} ${check.label}${hint}`);
  }
  const failed = report.checks.filter((check) => check.status === "FAIL").length;
  const warned = report.checks.filter((check) => check.status === "WARN").length;
  console.log(`summary fail=${failed} warn=${warned}`);
  process.exitCode = doctorExitCode(report.checks);
}

main()
  .catch((error) => {
    console.error("FAIL  doctor       " + (error instanceof Error ? error.message : error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
