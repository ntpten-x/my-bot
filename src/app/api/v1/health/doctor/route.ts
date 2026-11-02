import { authed } from "@/lib/guard";
import { json } from "@/lib/http";
import { collectDoctorReport } from "@/lib/doctor-run";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authed();
  if (error) return error;
  const report = await collectDoctorReport();
  return json({ port: report.port, checks: report.checks });
}
