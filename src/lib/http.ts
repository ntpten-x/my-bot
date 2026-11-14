import { NextResponse } from "next/server";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

/** CORS headers are added by src/middleware.ts for allowed origins only (the extension and this site). */
export function withCors(response: NextResponse) {
  return response;
}

export function corsPreflight() {
  return new NextResponse(null, { status: 204 });
}
