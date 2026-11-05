import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/auth-cookie";
import { allowedCorsOrigin, selfOriginOf } from "./lib/request-security";

const PUBLIC_PATHS = new Set(["/login", "/setup"]);

function applyCors(request: NextRequest, response: NextResponse) {
  const origin = allowedCorsOrigin(request.headers.get("origin"), selfOriginOf(request.headers, request.url));
  response.headers.set("Vary", "Origin");
  if (!origin) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api")) {
    if (request.method === "OPTIONS") return applyCors(request, new NextResponse(null, { status: 204 }));
    return applyCors(request, NextResponse.next());
  }
  if (pathname === "/health" || pathname.startsWith("/_next")) return NextResponse.next();
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession && !PUBLIC_PATHS.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (hasSession && PUBLIC_PATHS.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192.png|icon-512.png|apple-touch-icon.png|sw.js|manifest.webmanifest).*)"],
};