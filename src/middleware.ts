import { NextResponse, type NextRequest } from "next/server";
import { authMutationError } from "./lib/auth-request";
import { securityHeaders } from "./lib/security-headers";
import { isHttpsRequest } from "./lib/request-security";
import { SESSION_COOKIE } from "./lib/auth-cookie";
import { allowedCorsOrigin, selfOriginOf } from "./lib/request-security";

const PUBLIC_PATHS = new Set(["/login", "/setup", "/reset-password"]);

function applyCors(request: NextRequest, response: NextResponse) {
  const origin = allowedCorsOrigin(request.headers.get("origin"), selfOriginOf(request.headers, request.url));
  response.headers.set("Vary", "Origin");
  if (!origin) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Extension-Version, X-Extension-Runtime, X-Facebook-User-Id");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = securityHeaders(process.env.NODE_ENV === "production", nonce);
  const forward = new Headers(request.headers);
  forward.set("x-nonce", nonce);
  forward.set("x-mybot-path", request.nextUrl.pathname);
  forward.set("Content-Security-Policy", policy["Content-Security-Policy"]);
  const response = handleRequest(request, forward);
  for (const [key, value] of Object.entries(policy)) response.headers.set(key, value);
  if (isHttpsRequest(request.headers, request.url)) response.headers.set("Strict-Transport-Security", "max-age=31536000");
  if (request.nextUrl.pathname.startsWith("/api/") || !request.nextUrl.pathname.startsWith("/_next/")) response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function handleRequest(request: NextRequest, forward: Headers) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api")) {
    // Extension v1 APIs use bearer tokens, never browser session cookies.
    if (!pathname.startsWith("/api/v1/") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const error = authMutationError(request, false);
      if (error) return error;
    }
    if (request.method === "OPTIONS") return applyCors(request, new NextResponse(null, { status: 204 }));
    return applyCors(request, NextResponse.next({ request: { headers: forward } }));
  }
  if (pathname === "/health" || pathname.startsWith("/_next")) return NextResponse.next({ request: { headers: forward } });
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (!hasSession && !PUBLIC_PATHS.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  // Cookie presence cannot prove a session is valid. The login page checks
  // /api/auth/status, so expired/revoked cookies must still reach the form.
  return NextResponse.next({ request: { headers: forward } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192.png|icon-512.png|apple-touch-icon.png|sw.js|manifest.webmanifest).*)"],
};
