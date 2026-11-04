import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { collectDoctorReport } from "@/lib/doctor-run";
import { memo } from "@/lib/memo";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  // Repeated opens within 15 s share one run of the checks.
  const report = await memo("doctor", 15_000, collectDoctorReport);
  return json({ port: report.port, checks: report.checks });
}
