import { healthResponse } from "@/lib/public-health-server";

export const dynamic = "force-dynamic";

export function GET() {
  return healthResponse(false);
}

export function HEAD() {
  return healthResponse(true);
}