// Pure helpers: is this request HTTPS / local, and which Origin may call the API cross-site.
type HeaderLike = { get(name: string): string | null };

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(host: string) {
  const clean = host.trim().toLowerCase();
  if (clean.startsWith("[")) return clean.slice(0, clean.indexOf("]") + 1);
  return clean.split(":")[0];
}

export function isLocalHost(host: string | null | undefined) {
  return Boolean(host) && LOCAL_HOSTNAMES.has(hostname(String(host)));
}

/** Local = the Host header is localhost/127.0.0.1 (a public proxy such as Render never forwards that). */
export function isLocalRequest(headers: HeaderLike, url?: string) {
  const host = headers.get("host") ?? (url ? new URL(url).host : "");
  return isLocalHost(host);
}

export function isHttpsRequest(headers: HeaderLike, url?: string) {
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return Boolean(url && url.startsWith("https://"));
}

/** Extension endpoints: HTTPS everywhere, plain HTTP only for the local app. */
export function transportAllowed(headers: HeaderLike, url?: string) {
  return isHttpsRequest(headers, url) || isLocalRequest(headers, url);
}

/** CORS: only the MY-BOT extension and this site's own origin. */
export function allowedCorsOrigin(origin: string | null, selfOrigin: string): string | null {
  if (!origin) return null;
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
  if (origin === selfOrigin) return origin;
  return null;
}

export function selfOriginOf(headers: HeaderLike, url: string) {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? new URL(url).host;
  return `${isHttpsRequest(headers, url) ? "https" : "http"}://${host}`;
}