import { publicHealth } from "@/lib/version";
import { corsPreflight, json, withCors } from "@/lib/http";
import { publicBuildHeaders } from "@/lib/build-info";

export const dynamic = "force-dynamic";

export function GET() {
  const response = json(publicHealth());
  for (const [key, value] of Object.entries(publicBuildHeaders())) response.headers.set(key, value);
  return withCors(response);
}

export function OPTIONS() {
  return corsPreflight();
}
