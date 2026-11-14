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

/** RFC1918 LAN addresses used when opening the local app from Desktop/WSL via the Windows host IP. */
export function isPrivateLanHost(host: string | null | undefined) {
  const name = hostname(String(host || ""));
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [a, b] = parts;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function isLocalNetworkHost(host: string | null | undefined) {
  return isLocalHost(host) || isPrivateLanHost(host);
}

/** Local = the Host header is localhost/127.0.0.1 (a public proxy such as Render never forwards that). */
export function isLocalRequest(headers: HeaderLike, url?: string) {
  const host = headers.get("host") ?? (url ? new URL(url).host : "");
  return isLocalHost(host) && (!url || isLocalHost(new URL(url).host));
}

export function isHttpsRequest(headers: HeaderLike, url?: string) {
  if (url?.startsWith("https://")) return true;
  const forwarded = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return Boolean(url && url.startsWith("https://"));
}

/** Extension endpoints: HTTPS everywhere, plain HTTP on loopback or private LAN. */
export function transportAllowed(headers: HeaderLike, url?: string) {
  const host = headers.get("host") ?? (url ? new URL(url).host : "");
  return isHttpsRequest(headers, url) || isLocalNetworkHost(host);
}

/** CORS: only the MY-BOT extension and this site's own origin. */
export function allowedCorsOrigin(origin: string | null, selfOrigin: string): string | null {
  if (!origin) return null;
  if (/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return origin;
  if (origin === selfOrigin) return origin;
  return null;
}

export function selfOriginOf(headers: HeaderLike, url: string) {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  const host = headers.get("host") ?? new URL(url).host;
  return `${isHttpsRequest(headers, url) ? "https" : "http"}://${host}`;
}