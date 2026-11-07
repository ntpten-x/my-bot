import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";

export function publicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:db8|0):/i.test(address);
}
export function allowedImageUrl(value: string) {
  try {
    const u = new URL(value);
    const hosts = ["fbcdn.net", "fbsbx.com", ...(process.env.IMAGE_ALLOWED_HOSTS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean)];
    return u.protocol === "https:" && !u.username && !u.password && !u.port && hosts.some(host => u.hostname === host || u.hostname.endsWith(`.${host}`));
  } catch { return false; }
}
/** HTTPS, allowlisted hosts, pinned public DNS, every redirect checked, bounded bytes. */
export async function fetchImage(value: string, redirects = 0): Promise<Buffer | null> {
  if (!allowedImageUrl(value) || redirects > 3) return null;
  const u = new URL(value);
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some(row => !publicAddress(row.address))) return null;
  const result = await new Promise<Buffer | string | null>((resolve, reject) => {
    const req = request(u, { signal: AbortSignal.timeout(8000), lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    } }, res => {
      if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) { res.destroy(); resolve(res.headers.location ? new URL(res.headers.location, u).href : null); return; }
      if (res.statusCode !== 200 || !/^image\/(?:jpeg|png|webp)/i.test(res.headers["content-type"] || "") || Number(res.headers["content-length"]) > 2_000_000) { res.destroy(); resolve(null); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) { res.destroy(); resolve(null); } else chunks.push(chunk); });
      res.on("end", () => resolve(size ? Buffer.concat(chunks) : null));
      res.on("error", reject);
    });
    req.on("error", reject); req.end();
  });
  return typeof result === "string" ? fetchImage(result, redirects + 1) : result;
}
