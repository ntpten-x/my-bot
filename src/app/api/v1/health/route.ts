import { publicHealth } from "@/lib/version";
import { corsPreflight, json, withCors } from "@/lib/http";

export const dynamic = "force-dynamic";

export function GET() {
  return withCors(json(publicHealth()));
}

export function OPTIONS() {
  return corsPreflight();
}
